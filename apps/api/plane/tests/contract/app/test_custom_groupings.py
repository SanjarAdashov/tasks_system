import uuid

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Project,
    ProjectCustomGrouping,
    ProjectMember,
    ProjectWorkItemPropertyOption,
    ProjectWorkItemProperty,
    Issue,
    State,
    User,
    WorkItemPropertyValue,
    WorkspaceMember,
)


@pytest.fixture
def grouping_project(workspace, create_user):
    project = Project(name="Grouping", identifier="GRP", workspace=workspace)
    project.save(created_by_id=create_user.id)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def grouping_member(workspace, grouping_project):
    user = User.objects.create_user(
        email=f"grouping-{uuid.uuid4().hex}@plane.so",
        username=uuid.uuid4().hex,
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    ProjectMember.objects.create(
        workspace=workspace,
        project=grouping_project,
        member=user,
        role=15,
        is_active=True,
    )
    return user


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectCustomGroupings:
    def test_personal_and_shared_visibility_and_permissions(
        self,
        session_client,
        create_user,
        workspace,
        grouping_project,
        grouping_member,
    ):
        url = f"/api/workspaces/{workspace.slug}/projects/{grouping_project.id}/custom-groupings/"
        personal = session_client.post(
            url,
            {"name": "My status", "group_by": "state", "access": "PERSONAL"},
            format="json",
        )
        assert personal.status_code == 201
        shared = session_client.post(
            url,
            {"name": "Team priority", "group_by": "priority", "access": "PROJECT"},
            format="json",
        )
        assert shared.status_code == 201

        member_client = APIClient()
        member_client.force_authenticate(grouping_member)
        visible = member_client.get(url)
        assert visible.status_code == 200
        assert [item["name"] for item in visible.data] == ["Team priority"]
        forbidden = member_client.post(
            url,
            {"name": "Forbidden shared", "group_by": "state", "access": "PROJECT"},
            format="json",
        )
        assert forbidden.status_code == 403
        own = member_client.post(
            url,
            {"name": "My assignees", "group_by": "assignees", "access": "PERSONAL"},
            format="json",
        )
        assert own.status_code == 201

        shared_id = str(shared.data["id"])
        preference = member_client.patch(
            f"{url}preference/",
            {
                "active_grouping": shared_id,
                "collapsed_groups": {shared_id: ["none", "backlog"]},
            },
            format="json",
        )
        assert preference.status_code == 200
        assert str(preference.data["active_grouping"]) == shared_id

    def test_hidden_or_archived_grouping_field_deletes_configuration(
        self,
        session_client,
        workspace,
        grouping_project,
    ):
        url = f"/api/workspaces/{workspace.slug}/projects/{grouping_project.id}/custom-groupings/"
        start_date_group = session_client.post(
            url,
            {"name": "By start", "group_by": "start_date", "date_bucket": "WEEK", "access": "PERSONAL"},
            format="json",
        )
        assert start_date_group.status_code == 201
        hidden = session_client.patch(
            f"/api/workspaces/{workspace.slug}/projects/{grouping_project.id}/work-item-fields/configuration/",
            {"built_in_fields": {"start_date": {"visible": False}}},
            format="json",
        )
        assert hidden.status_code == 200
        assert not ProjectCustomGrouping.objects.filter(id=start_date_group.data["id"]).exists()

        property_instance = ProjectWorkItemProperty.objects.create(
            workspace=workspace,
            project=grouping_project,
            name="Approval",
            property_type="CHECKBOX",
        )
        custom = session_client.post(
            url,
            {
                "name": "By approval",
                "group_by": f"customproperty_{property_instance.id}",
                "access": "PERSONAL",
            },
            format="json",
        )
        assert custom.status_code == 201
        archived = session_client.delete(
            f"/api/workspaces/{workspace.slug}/projects/{grouping_project.id}/work-item-fields/properties/{property_instance.id}/"
        )
        assert archived.status_code == 204
        assert not ProjectCustomGrouping.objects.filter(id=custom.data["id"]).exists()

    def test_issue_api_groups_dates_by_week_and_multi_select_into_each_value(
        self,
        session_client,
        create_user,
        workspace,
        grouping_project,
    ):
        state = State.objects.create(
            workspace=workspace,
            project=grouping_project,
            name="Todo",
            group="unstarted",
        )
        first = Issue.objects.create(
            workspace=workspace,
            project=grouping_project,
            state=state,
            name="Monday",
            start_date="2026-08-03",
            created_by=create_user,
        )
        second = Issue.objects.create(
            workspace=workspace,
            project=grouping_project,
            state=state,
            name="Friday",
            start_date="2026-08-07",
            created_by=create_user,
        )
        issues_url = f"/api/workspaces/{workspace.slug}/projects/{grouping_project.id}/issues/"
        weekly = session_client.get(f"{issues_url}?group_by=datebucket_week_start_date&per_page=50")
        assert weekly.status_code == 200
        assert weekly.data["results"]["2026-08-03"]["total_results"] == 2
        assert {str(item["id"]) for item in weekly.data["results"]["2026-08-03"]["results"]} == {
            str(first.id),
            str(second.id),
        }

        property_instance = ProjectWorkItemProperty.objects.create(
            workspace=workspace,
            project=grouping_project,
            name="Regions",
            property_type="MULTI_SELECT",
        )
        north = ProjectWorkItemPropertyOption.objects.create(
            workspace=workspace,
            project=grouping_project,
            property=property_instance,
            name="North",
        )
        south = ProjectWorkItemPropertyOption.objects.create(
            workspace=workspace,
            project=grouping_project,
            property=property_instance,
            name="South",
        )
        WorkItemPropertyValue.objects.create(
            workspace=workspace,
            project=grouping_project,
            issue=first,
            property=property_instance,
            value=[str(north.id), str(south.id)],
        )
        grouped = session_client.get(
            f"{issues_url}?group_by=customproperty_{property_instance.id}&per_page=50"
        )
        assert grouped.status_code == 200
        assert [str(item["id"]) for item in grouped.data["results"][str(north.id)]["results"]] == [str(first.id)]
        assert [str(item["id"]) for item in grouped.data["results"][str(south.id)]["results"]] == [str(first.id)]

        date_property = ProjectWorkItemProperty.objects.create(
            workspace=workspace,
            project=grouping_project,
            name="Review date",
            property_type="DATE",
        )
        WorkItemPropertyValue.objects.create(
            workspace=workspace,
            project=grouping_project,
            issue=second,
            property=date_property,
            value="2026-08-07",
        )
        custom_weekly = session_client.get(
            f"{issues_url}?group_by=datebucket_week_customproperty_{date_property.id}&per_page=50"
        )
        assert custom_weekly.status_code == 200
        assert [
            str(item["id"])
            for item in custom_weekly.data["results"]["2026-08-03"]["results"]
        ] == [str(second.id)]
