import uuid

import pytest
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    Project,
    ProjectCreationQuota,
    ProjectMember,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectUserGroup,
    ProjectUserGroupMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import Instance, InstanceAdmin
from plane.license.services import CreationQuotaError, assert_can_create_project, assert_can_create_workspace
from plane.utils.project_user_groups import copy_project_user_groups_and_transition_rules
from plane.utils.state_transition_rules import evaluate_state_transition


def tree(field=None, value=None):
    children = [] if field is None else [{"kind": "condition", "field": field, "operator": "EQ", "value": str(value)}]
    return {"kind": "group", "operator": "AND", "children": children}


@pytest.mark.contract
@pytest.mark.django_db
class TestCreationQuotas:
    def test_workspace_create_endpoint_enforces_and_consumes_quota(self, mocker, session_client, create_user):
        mocker.patch("plane.bgtasks.workspace_seed_task.workspace_seed.delay")
        payload = {"name": "Quota workspace", "slug": f"quota-{uuid.uuid4().hex[:8]}"}

        denied = session_client.post("/api/workspaces/", payload, format="json")
        assert denied.status_code == 403
        assert denied.data["error"]["code"] == "workspace_quota_exceeded"

        create_user.workspace_creation_limit = 1
        create_user.save(update_fields=["workspace_creation_limit", "updated_at"])
        created = session_client.post("/api/workspaces/", payload, format="json")
        assert created.status_code == 201
        assert Workspace.objects.get(pk=created.data["id"]).owner_id == create_user.id

        exhausted = session_client.post(
            "/api/workspaces/",
            {"name": "Second workspace", "slug": f"quota-{uuid.uuid4().hex[:8]}"},
            format="json",
        )
        assert exhausted.status_code == 403
        assert exhausted.data["error"]["code"] == "workspace_quota_exceeded"

    def test_project_create_endpoint_enforces_and_consumes_quota(self, session_client, create_user, workspace):
        payload = {"name": "First quota project", "identifier": "FQP"}
        denied = session_client.post(f"/api/workspaces/{workspace.slug}/projects/", payload, format="json")
        assert denied.status_code == 403
        assert denied.data["error"]["code"] == "project_quota_exceeded"

        ProjectCreationQuota.objects.create(user=create_user, workspace=workspace, limit=1)
        created = session_client.post(f"/api/workspaces/{workspace.slug}/projects/", payload, format="json")
        assert created.status_code == 201
        project = Project.objects.get(pk=created.data["id"])
        assert project.created_by_id == create_user.id

        exhausted = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/",
            {"name": "Second quota project", "identifier": "SQP"},
            format="json",
        )
        assert exhausted.status_code == 403
        assert exhausted.data["error"]["code"] == "project_quota_exceeded"

    def test_public_api_project_create_enforces_quota_and_records_creator(
        self,
        api_key_client,
        create_user,
        workspace,
    ):
        url = f"/api/v1/workspaces/{workspace.slug}/projects/"
        denied = api_key_client.post(
            url,
            {"name": "Public denied", "identifier": "PBD"},
            format="json",
        )
        assert denied.status_code == 403
        assert denied.data["error"]["code"] == "project_quota_exceeded"

        ProjectCreationQuota.objects.create(user=create_user, workspace=workspace, limit=1)
        created = api_key_client.post(
            url,
            {"name": "Public allowed", "identifier": "PBA"},
            format="json",
        )
        assert created.status_code == 201
        assert Project.objects.get(pk=created.data["id"]).created_by_id == create_user.id

    def test_workspace_quota_defaults_to_zero_and_deletion_frees_capacity(self, create_user):
        with pytest.raises(CreationQuotaError) as error, transaction.atomic():
            assert_can_create_workspace(create_user)
        assert error.value.code == "workspace_quota_exceeded"

        create_user.workspace_creation_limit = 1
        create_user.save(update_fields=["workspace_creation_limit"])
        with transaction.atomic():
            assert_can_create_workspace(create_user)
            workspace = Workspace.objects.create(name="Quota", slug=f"q-{uuid.uuid4().hex[:8]}", owner=create_user)
        with pytest.raises(CreationQuotaError), transaction.atomic():
            assert_can_create_workspace(create_user)
        workspace.delete()
        with transaction.atomic():
            assert_can_create_workspace(create_user)

    def test_project_quota_counts_archived_projects_and_requires_active_membership(self, create_user, workspace):
        with pytest.raises(CreationQuotaError) as error, transaction.atomic():
            assert_can_create_project(create_user, workspace)
        assert error.value.code == "project_quota_exceeded"

        ProjectCreationQuota.objects.create(user=create_user, workspace=workspace, limit=1)
        with transaction.atomic():
            assert_can_create_project(create_user, workspace)
            project = Project(name="Quota project", identifier="QTA", workspace=workspace)
            project.save(created_by_id=create_user.id)
        project.archived_at = timezone.now()
        project.save(update_fields=["archived_at"])
        with pytest.raises(CreationQuotaError), transaction.atomic():
            assert_can_create_project(create_user, workspace)
        project.delete()
        with transaction.atomic():
            assert_can_create_project(create_user, workspace)

        workspace_membership = WorkspaceMember.objects.get(workspace=workspace, member=create_user)
        workspace_membership.is_active = False
        workspace_membership.save(update_fields=["is_active", "updated_at"])
        with pytest.raises(CreationQuotaError) as inactive_error, transaction.atomic():
            assert_can_create_project(create_user, workspace)
        assert inactive_error.value.code == "workspace_membership_required"

    def test_guest_workspace_member_can_create_project_when_quota_is_positive(self, workspace):
        guest = User.objects.create_user(
            email=f"quota-guest-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
        )
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
        ProjectCreationQuota.objects.create(user=guest, workspace=workspace, limit=1)
        client = APIClient()
        client.force_authenticate(guest)

        response = client.post(
            f"/api/workspaces/{workspace.slug}/projects/",
            {"name": "Guest quota project", "identifier": "GQP"},
            format="json",
        )

        assert response.status_code == 201
        assert Project.objects.get(pk=response.data["id"]).created_by_id == guest.id

    def test_instance_admin_is_unlimited(self, create_user, workspace):
        instance = Instance.objects.create(
            instance_name="Test",
            instance_id=uuid.uuid4().hex,
            current_version="test",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=create_user)
        with transaction.atomic():
            assert_can_create_workspace(create_user)
            assert_can_create_project(create_user, workspace)

    def test_instance_admin_can_update_quotas_and_user_can_read_them(self, create_user, workspace):
        admin = User.objects.create_user(
            email=f"quota-admin-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
        )
        instance = Instance.objects.create(
            instance_name="Quota management",
            instance_id=uuid.uuid4().hex,
            current_version="test",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=admin)

        admin_client = APIClient()
        admin_client.force_authenticate(admin)
        response = admin_client.patch(
            f"/api/instances/users/{create_user.id}/creation-quotas/",
            {
                "workspace_limit": 2,
                "project_quota": {"workspace_id": str(workspace.id), "limit": 3},
            },
            format="json",
        )
        assert response.status_code == 200
        assert response.data["workspace"]["limit"] == 2
        project_quota = next(item for item in response.data["projects"] if item["workspace_id"] == str(workspace.id))
        assert project_quota["limit"] == 3

        create_user.refresh_from_db()
        user_client = APIClient()
        user_client.force_authenticate(create_user)
        own_snapshot = user_client.get("/api/users/me/creation-quotas/")
        assert own_snapshot.status_code == 200
        assert own_snapshot.data["workspace"]["limit"] == 2
        assert own_snapshot.data["projects"][0]["limit"] == 3

        unlimited = admin_client.patch(
            f"/api/instances/users/{create_user.id}/creation-quotas/",
            {
                "workspace_limit": None,
                "project_quota": {"workspace_id": str(workspace.id), "limit": None},
            },
            format="json",
        )
        assert unlimited.status_code == 200
        assert unlimited.data["workspace"]["is_unlimited"] is True
        assert unlimited.data["projects"][0]["is_unlimited"] is True


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectUserGroupsInTransitions:
    def test_group_api_is_admin_only_and_referenced_group_cannot_be_deleted(self, create_user, workspace):
        project = Project(name="Group API", identifier="GAPI", workspace=workspace)
        project.save(created_by_id=create_user.id)
        ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
        member = User.objects.create_user(email=f"member-{uuid.uuid4().hex}@plane.so", username=uuid.uuid4().hex)
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        ProjectMember.objects.create(project=project, workspace=workspace, member=member, role=15)
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/user-groups/"

        member_client = APIClient()
        member_client.force_authenticate(member)
        assert member_client.get(url).status_code == 403

        admin_client = APIClient()
        admin_client.force_authenticate(create_user)
        created = admin_client.post(url, {"name": "Reviewers", "member_ids": [str(member.id)]}, format="json")
        assert created.status_code == 201
        group_id = created.data["id"]
        assert created.data["members"][0]["member_id"] == str(member.id)

        member.blocked_at = timezone.now()
        member.save(update_fields=["blocked_at", "updated_at"])
        project_membership = ProjectMember.objects.get(project=project, member=member)
        project_membership.is_active = False
        project_membership.save(update_fields=["is_active", "updated_at"])
        retained = admin_client.get(f"{url}?include_archived=true")
        assert retained.status_code == 200
        assert retained.data[0]["members"][0]["account_status"] == "blocked"
        assert retained.data[0]["members"][0]["project_member_active"] is False

        source = State.objects.create(project=project, workspace=workspace, name="Todo", group="unstarted")
        target = State.objects.create(project=project, workspace=workspace, name="Done", group="completed")
        rule = ProjectStateTransitionRule.objects.create(
            project=project,
            workspace=workspace,
            source_type="EXACT",
            source_state=source,
            target_state=target,
            allow_conditions=tree("actor.group", group_id),
            deny_conditions=tree(),
            validation_conditions=tree(),
        )
        rule.archived_at = timezone.now()
        rule.save(update_fields=["archived_at", "updated_at"])
        detail = f"{url}{group_id}/"
        assert admin_client.delete(detail).status_code == 204
        permanent = admin_client.delete(f"{detail}?permanent=true&include_archived=true")
        assert permanent.status_code == 409
        assert permanent.data["error"]["code"] == "group_in_use"

    def test_instance_admin_can_manage_groups_without_project_membership(self, create_user, workspace):
        project = Project(name="God groups", identifier="GODG", workspace=workspace)
        project.save(created_by_id=create_user.id)
        ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
        instance_admin = User.objects.create_user(
            email=f"group-god-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
        )
        instance = Instance.objects.create(
            instance_name="Group God Mode",
            instance_id=uuid.uuid4().hex,
            current_version="test",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=instance_admin)
        client = APIClient()
        client.force_authenticate(instance_admin)

        context = client.get(f"/api/instances/project-user-groups/?project_id={project.id}")
        assert context.status_code == 200
        assert any(item["id"] == str(project.id) for item in context.data["workspaces"][0]["projects"])

        group_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/user-groups/"
        created = client.post(group_url, {"name": "God managed"}, format="json")
        assert created.status_code == 201
        assert ProjectUserGroup.objects.filter(project=project, name="God managed").exists()

    def test_actor_and_all_assignees_group_conditions(self, create_user, workspace):
        project = Project.objects.create(name="Groups", identifier="GRP", workspace=workspace, created_by=create_user)
        ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
        outsider = User.objects.create_user(email=f"outside-{uuid.uuid4().hex}@plane.so", username=uuid.uuid4().hex)
        WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
        ProjectMember.objects.create(project=project, workspace=workspace, member=outsider, role=15)
        source = State.objects.create(project=project, workspace=workspace, name="Todo", group="unstarted")
        target = State.objects.create(project=project, workspace=workspace, name="Review", group="started")
        issue = Issue.objects.create(
            project=project,
            workspace=workspace,
            state=source,
            name="Grouped",
            created_by=create_user,
        )
        group = ProjectUserGroup.objects.create(project=project, workspace=workspace, name="Reviewers")
        ProjectUserGroupMember.objects.create(project=project, workspace=workspace, group=group, member=create_user)
        rule = ProjectStateTransitionRule.objects.create(
            project=project,
            workspace=workspace,
            source_type="EXACT",
            source_state=source,
            target_state=target,
            allow_conditions=tree("actor.group", group.id),
            deny_conditions=tree(),
            validation_conditions=tree(),
        )

        assert evaluate_state_transition(project=project, actor=create_user, issue=issue, target_state=target).allowed
        denied = evaluate_state_transition(project=project, actor=outsider, issue=issue, target_state=target)
        assert denied.allowed is False
        assert denied.reasons == ["You do not have permission to perform this status transition."]

        rule.allow_conditions = tree("assignees.group_all", group.id)
        rule.save(update_fields=["allow_conditions"])
        assert not evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=target,
            attrs={"assignee_ids": []},
        ).allowed
        assert evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=target,
            attrs={"assignee_ids": [create_user.id]},
        ).allowed
        assert not evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=target,
            attrs={"assignee_ids": [create_user.id, outsider.id]},
        ).allowed

    def test_project_copy_remaps_groups_members_and_transition_rules(self, create_user, workspace):
        source_project = Project(name="Source groups", identifier="SGRP", workspace=workspace)
        source_project.save(created_by_id=create_user.id)
        target_project = Project(name="Target groups", identifier="TGRP", workspace=workspace)
        target_project.save(created_by_id=create_user.id)

        source_state = State.objects.create(
            project=source_project,
            workspace=workspace,
            name="Source",
            group="unstarted",
        )
        source_target = State.objects.create(
            project=source_project,
            workspace=workspace,
            name="Target",
            group="started",
        )
        copied_source = State.objects.create(
            project=target_project,
            workspace=workspace,
            name="Source",
            group="unstarted",
        )
        copied_target = State.objects.create(
            project=target_project,
            workspace=workspace,
            name="Target",
            group="started",
        )
        source_group = ProjectUserGroup.objects.create(
            project=source_project,
            workspace=workspace,
            name="Approvers",
        )
        ProjectUserGroupMember.objects.create(
            project=source_project,
            workspace=workspace,
            group=source_group,
            member=create_user,
        )
        ProjectStateTransitionSettings.objects.create(
            project=source_project,
            workspace=workspace,
            strict_mode=True,
        )
        source_rule = ProjectStateTransitionRule.objects.create(
            project=source_project,
            workspace=workspace,
            source_type="EXACT",
            source_state=source_state,
            target_state=source_target,
            allow_conditions=tree("actor.group", source_group.id),
            deny_conditions=tree(),
            validation_conditions=tree(),
        )

        group_map = copy_project_user_groups_and_transition_rules(
            source_project=source_project,
            target_project=target_project,
            state_id_map={
                str(source_state.id): copied_source.id,
                str(source_target.id): copied_target.id,
            },
        )

        copied_group = ProjectUserGroup.objects.get(project=target_project)
        copied_rule = ProjectStateTransitionRule.objects.get(project=target_project)
        assert group_map[str(source_group.id)] == copied_group.id
        assert copied_group.memberships.get().member_id == create_user.id
        assert copied_rule.source_state_id == copied_source.id
        assert copied_rule.target_state_id == copied_target.id
        assert copied_rule.allow_conditions["children"][0]["value"] == str(copied_group.id)
        assert copied_rule.id != source_rule.id
        assert ProjectStateTransitionSettings.objects.get(project=target_project).strict_mode is True
