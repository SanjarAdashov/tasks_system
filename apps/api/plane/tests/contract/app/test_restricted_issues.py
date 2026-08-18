# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.bgtasks.webhook_task import _event_belongs_to_restricted_issue
from plane.db.models import (
    Issue,
    IssueAccessAuditLog,
    IssueComment,
    IssueRelation,
    IssueVisibility,
    FileAsset,
    Notification,
    Project,
    ProjectMember,
    ProjectUserGroup,
    ProjectUserGroupMember,
    ProjectWorkItemProperty,
    State,
    User,
    WorkspaceMember,
)
from plane.utils.issue_access import can_view_issue, issue_access_summary
from plane.license.models import Instance, InstanceAdmin


def issue_url(workspace, project, issue_id=None):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    return f"{base}{issue_id}/" if issue_id else base


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def add_project_user(workspace, project, label):
    user = User.objects.create_user(
        email=f"restricted-{label}-{uuid.uuid4().hex}@example.com",
        username=f"restricted-{label}-{uuid.uuid4().hex}",
        first_name=label.title(),
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=15,
        is_active=True,
    )
    return user


@pytest.fixture
def restricted_project(workspace, create_user):
    project = Project.objects.create(
        workspace=workspace,
        name="Restricted tasks",
        identifier=f"RST{uuid.uuid4().hex[:4].upper()}",
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    State.objects.create(
        project=project,
        workspace=workspace,
        name="Open",
        color="#3366ff",
        group="started",
        sequence=100,
        default=True,
    )
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestRestrictedIssues:
    def test_workspace_and_instance_admins_can_retrieve_without_project_membership(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        workspace_admin = User.objects.create_user(
            email=f"restricted-workspace-admin-{uuid.uuid4().hex}@example.com",
            username=f"restricted-workspace-admin-{uuid.uuid4().hex}",
        )
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=workspace_admin,
            role=20,
            is_active=True,
        )
        instance_admin = User.objects.create_user(
            email=f"restricted-instance-admin-{uuid.uuid4().hex}@example.com",
            username=f"restricted-instance-admin-{uuid.uuid4().hex}",
        )
        instance = Instance.objects.create(
            instance_name="Restricted issue access",
            instance_id=uuid.uuid4().hex,
            current_version="test",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=instance_admin)

        created = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Administrator access", "visibility": IssueVisibility.RESTRICTED},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data
        url = issue_url(workspace, restricted_project, created.data["id"])

        assert client_for(workspace_admin).get(url).status_code == status.HTTP_200_OK
        assert client_for(instance_admin).get(url).status_code == status.HTTP_200_OK

    def test_workspace_member_without_project_access_receives_not_found(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        nonmember = User.objects.create_user(
            email=f"restricted-nonmember-{uuid.uuid4().hex}@example.com",
            username=f"restricted-nonmember-{uuid.uuid4().hex}",
        )
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=nonmember,
            role=15,
            is_active=True,
        )
        created = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "No existence oracle", "visibility": IssueVisibility.RESTRICTED},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data

        response = client_for(nonmember).get(issue_url(workspace, restricted_project, created.data["id"]))

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_revoked_user_no_longer_sees_existing_notification(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "revoked-notification")
        created = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Notification revocation",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data
        issue_id = created.data["id"]
        notification = Notification.objects.create(
            workspace=workspace,
            project=restricted_project,
            entity_identifier=issue_id,
            entity_name="issue",
            title="Restricted notification",
            sender="assigned",
            receiver=assignee,
        )
        notifications_url = f"/api/workspaces/{workspace.slug}/users/notifications/"
        assignee_client = client_for(assignee)

        visible = assignee_client.get(notifications_url)
        assert visible.status_code == status.HTTP_200_OK
        assert str(notification.id) in {str(item["id"]) for item in visible.data}

        revoked = session_client.patch(
            issue_url(workspace, restricted_project, issue_id),
            {"assignee_ids": []},
            format="json",
        )
        assert revoked.status_code == status.HTTP_204_NO_CONTENT, revoked.data

        hidden = assignee_client.get(notifications_url)
        assert hidden.status_code == status.HTTP_200_OK
        assert str(notification.id) not in {str(item["id"]) for item in hidden.data}

    def test_restricted_attachment_requires_access_and_uses_short_signed_url(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "attachment-user")
        outsider = add_project_user(workspace, restricted_project, "attachment-outsider")
        created = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Restricted attachment",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data
        issue = Issue.unscoped_objects.get(id=created.data["id"])
        attachment = FileAsset.objects.create(
            attributes={"name": "private.pdf", "type": "application/pdf", "size": 128},
            asset=f"{workspace.id}/private.pdf",
            size=128,
            workspace=workspace,
            project=restricted_project,
            issue=issue,
            created_by=assignee,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
            storage_metadata={"size": 128},
        )
        url = f"/api/assets/v2/workspaces/{workspace.slug}/{attachment.id}/"

        with mock.patch("plane.app.views.asset.v2.S3Storage") as storage:
            denied = client_for(outsider).get(url)
            assert denied.status_code == status.HTTP_404_NOT_FOUND
            storage.return_value.generate_presigned_url.assert_not_called()

            storage.return_value.generate_presigned_url.return_value = "https://signed.example/private"
            allowed = client_for(assignee).get(url)
            assert allowed.status_code == status.HTTP_302_FOUND
            assert allowed.url == "https://signed.example/private"
            assert storage.return_value.generate_presigned_url.call_args.kwargs["expiration"] == 300

    def test_public_api_admin_comments_and_relation_visibility(
        self,
        session_client,
        workspace,
        create_user,
        restricted_project,
    ):
        workspace_admin = User.objects.create_user(
            email=f"restricted-api-admin-{uuid.uuid4().hex}@example.com",
            username=f"restricted-api-admin-{uuid.uuid4().hex}",
        )
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=workspace_admin,
            role=20,
            is_active=True,
        )
        outsider = add_project_user(workspace, restricted_project, "relation-outsider")
        restricted_response = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Hidden relation target", "visibility": IssueVisibility.RESTRICTED},
            format="json",
        )
        public_response = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Visible relation source"},
            format="json",
        )
        assert restricted_response.status_code == status.HTTP_201_CREATED, restricted_response.data
        assert public_response.status_code == status.HTTP_201_CREATED, public_response.data
        restricted_issue = Issue.unscoped_objects.get(id=restricted_response.data["id"])
        public_issue = Issue.unscoped_objects.get(id=public_response.data["id"])
        comment = IssueComment.objects.create(
            workspace=workspace,
            project=restricted_project,
            issue=restricted_issue,
            actor=create_user,
            created_by=create_user,
            comment_html="<p>Administrators can read this.</p>",
        )
        IssueRelation.objects.create(
            workspace=workspace,
            project=restricted_project,
            issue=public_issue,
            related_issue=restricted_issue,
            relation_type="relates_to",
            created_by=create_user,
        )

        comments_url = (
            f"/api/v1/workspaces/{workspace.slug}/projects/{restricted_project.id}/"
            f"work-items/{restricted_issue.id}/comments/"
        )
        admin_comments = client_for(workspace_admin).get(comments_url)
        assert admin_comments.status_code == status.HTTP_200_OK
        assert str(comment.id) in str(admin_comments.data)

        relations_url = (
            f"/api/v1/workspaces/{workspace.slug}/projects/{restricted_project.id}/"
            f"work-items/{public_issue.id}/relations/"
        )
        outsider_relations = client_for(outsider).get(relations_url)
        assert outsider_relations.status_code == status.HTTP_200_OK
        assert str(restricted_issue.id) not in str(outsider_relations.data)

        issue_detail_url = (
            f"/api/v1/workspaces/{workspace.slug}/projects/{restricted_project.id}/work-items/{restricted_issue.id}/"
        )
        updated = session_client.patch(
            issue_detail_url,
            {"assignees": [str(outsider.id)]},
            format="json",
        )
        assert updated.status_code == status.HTTP_200_OK, updated.data
        assert IssueAccessAuditLog.objects.filter(
            issue=restricted_issue,
            action="ASSIGNEES_CHANGED",
            actor=create_user,
        ).exists()

        public_detail_url = (
            f"/api/v1/workspaces/{workspace.slug}/projects/{restricted_project.id}/work-items/{public_issue.id}/"
        )
        reparented = session_client.patch(
            public_detail_url,
            {"parent": str(restricted_issue.id)},
            format="json",
        )
        assert reparented.status_code == status.HTTP_200_OK, reparented.data
        public_issue.refresh_from_db()
        assert public_issue.visibility == IssueVisibility.RESTRICTED
        assert public_issue.access_source_id == restricted_issue.id
        assert IssueAccessAuditLog.objects.filter(
            issue=public_issue,
            action="PARENT_ACCESS_APPLIED",
            actor=create_user,
        ).exists()

    def test_only_dynamic_acl_users_can_retrieve_restricted_issue(
        self,
        session_client,
        workspace,
        create_user,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "assignee")
        outsider = add_project_user(workspace, restricted_project, "outsider")

        created = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Private task",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data
        issue_id = created.data["id"]

        assert client_for(assignee).get(issue_url(workspace, restricted_project, issue_id)).status_code == 200
        assert client_for(outsider).get(issue_url(workspace, restricted_project, issue_id)).status_code == 404
        assert session_client.get(issue_url(workspace, restricted_project, issue_id)).status_code == 200
        assert IssueAccessAuditLog.objects.filter(
            issue_id=issue_id,
            action="VISIBILITY_CHANGED",
        ).exists()

    def test_member_property_and_group_membership_grants_are_dynamic(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        property_user = add_project_user(workspace, restricted_project, "developer")
        group_user = add_project_user(workspace, restricted_project, "reviewer")
        member_property = ProjectWorkItemProperty.objects.create(
            workspace=workspace,
            project=restricted_project,
            name="Developer",
            property_type="SINGLE_SELECT",
            select_source="MEMBERS",
        )
        group = ProjectUserGroup.objects.create(
            workspace=workspace,
            project=restricted_project,
            name="Review team",
        )
        ProjectUserGroupMember.objects.create(
            workspace=workspace,
            project=restricted_project,
            group=group,
            member=group_user,
        )

        response = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Dynamic access",
                "visibility": IssueVisibility.RESTRICTED,
                "property_values": {str(member_property.id): str(property_user.id)},
                "access_group_ids": [str(group.id)],
            },
            format="json",
        )
        assert response.status_code == 201, response.data
        issue = Issue.unscoped_objects.get(id=response.data["id"])

        assert can_view_issue(property_user, issue)
        assert can_view_issue(group_user, issue)
        summary = issue_access_summary(issue)
        assert {item["id"] for item in summary["groups"]} == {str(group.id)}

        membership = ProjectUserGroupMember.objects.get(group=group, member=group_user)
        membership.delete()
        assert not can_view_issue(group_user, issue)

        ProjectMember.objects.filter(project=restricted_project, member=property_user).update(is_active=False)
        assert not can_view_issue(property_user, issue)

    def test_non_owner_can_edit_content_but_not_access_sources(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "worker")
        other = add_project_user(workspace, restricted_project, "other")
        created = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Owner controlled ACL",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        assert created.status_code == 201
        url = issue_url(workspace, restricted_project, created.data["id"])
        assignee_client = client_for(assignee)

        assert assignee_client.patch(url, {"name": "Normal update"}, format="json").status_code == 204
        denied = assignee_client.patch(
            url,
            {"assignee_ids": [str(assignee.id), str(other.id)]},
            format="json",
        )
        assert denied.status_code == 400
        assert "access" in denied.data

    def test_restricted_child_inherits_parent_and_cannot_be_broader(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "parent-user")
        outsider = add_project_user(workspace, restricted_project, "child-outsider")
        parent_response = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Restricted parent",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        assert parent_response.status_code == 201
        parent = Issue.unscoped_objects.get(id=parent_response.data["id"])

        child_response = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Inherited child", "parent_id": str(parent.id)},
            format="json",
        )
        assert child_response.status_code == 201, child_response.data
        child = Issue.unscoped_objects.get(id=child_response.data["id"])
        assert child.visibility == IssueVisibility.RESTRICTED
        assert child.access_source_id == parent.id
        assert can_view_issue(assignee, child)
        assert not can_view_issue(outsider, child)

        broader = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Too broad",
                "parent_id": str(parent.id),
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(outsider.id)],
            },
            format="json",
        )
        assert broader.status_code == 400
        assert "access" in broader.data

    def test_bulk_sub_issue_assignment_uses_restricted_access_rules(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        assignee = add_project_user(workspace, restricted_project, "parent-assignee")
        parent_response = session_client.post(
            issue_url(workspace, restricted_project),
            {
                "name": "Restricted bulk parent",
                "visibility": IssueVisibility.RESTRICTED,
                "assignee_ids": [str(assignee.id)],
            },
            format="json",
        )
        child_response = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Public child candidate"},
            format="json",
        )
        assert parent_response.status_code == status.HTTP_201_CREATED, parent_response.data
        assert child_response.status_code == status.HTTP_201_CREATED, child_response.data
        parent_id = parent_response.data["id"]
        child_id = child_response.data["id"]
        url = f"/api/workspaces/{workspace.slug}/projects/{restricted_project.id}/issues/{parent_id}/sub-issues/"

        denied = client_for(assignee).post(
            url,
            {"sub_issue_ids": [child_id]},
            format="json",
        )
        assert denied.status_code == status.HTTP_400_BAD_REQUEST
        child = Issue.unscoped_objects.get(id=child_id)
        assert child.parent_id is None
        assert child.visibility == IssueVisibility.PROJECT

        allowed = session_client.post(
            url,
            {"sub_issue_ids": [child_id]},
            format="json",
        )
        assert allowed.status_code == status.HTTP_200_OK, allowed.data
        child.refresh_from_db()
        assert child.parent_id == uuid.UUID(str(parent_id))
        assert child.visibility == IssueVisibility.RESTRICTED
        assert child.access_source_id == uuid.UUID(str(parent_id))
        assert IssueAccessAuditLog.objects.filter(
            issue=child,
            action="PARENT_ACCESS_APPLIED",
        ).exists()

    def test_unauthorized_mentions_are_rejected_before_notification(
        self,
        session_client,
        workspace,
        restricted_project,
    ):
        outsider = add_project_user(workspace, restricted_project, "mention-target")
        created = session_client.post(
            issue_url(workspace, restricted_project),
            {"name": "Mention guard", "visibility": IssueVisibility.RESTRICTED},
            format="json",
        )
        assert created.status_code == 201
        issue_id = created.data["id"]
        comment_url = f"/api/workspaces/{workspace.slug}/projects/{restricted_project.id}/issues/{issue_id}/comments/"
        response = session_client.post(
            comment_url,
            {
                "comment_html": (
                    '<p><mention-component entity_name="user_mention" '
                    f'entity_identifier="{outsider.id}"></mention-component></p>'
                )
            },
            format="json",
        )
        assert response.status_code == 400
        assert response.data["mentions"]["code"] == "restricted_task_access_required"
        assert str(response.data["mentions"]["can_grant"]) == "true"

    def test_webhooks_skip_restricted_issue(self, workspace, restricted_project):
        issue = Issue.unscoped_objects.create(
            workspace=workspace,
            project=restricted_project,
            name="No webhook",
            visibility=IssueVisibility.RESTRICTED,
        )
        assert _event_belongs_to_restricted_issue("issue", issue.id)
