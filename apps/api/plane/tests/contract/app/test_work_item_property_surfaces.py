# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import (
    Issue,
    Project,
    ProjectMember,
    ProjectWorkItemProperty,
    ProjectWorkItemPropertyOption,
    State,
    User,
    WorkItemPropertyValue,
)
from plane.utils.porters.serializers.issue import IssueExportSerializer


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Property Surfaces",
        identifier="SURFACE",
        workspace=workspace,
    )
    ProjectMember.objects.create(
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    State.objects.create(
        name="Backlog",
        color="#000000",
        group="backlog",
        sequence=100,
        default=True,
        project=project,
    )
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkItemPropertySurfaces:
    def test_member_single_select_search_and_export_use_current_display_name(
        self,
        session_client,
        workspace,
        project,
    ):
        member = User.objects.create_user(
            email="dynamic-single-member@plane.so",
            username="dynamic-single-member",
            password="test-password",
            display_name="Initial Single Member Name",
        )
        ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Owner",
            property_type="SINGLE_SELECT",
            select_source="MEMBERS",
        )
        issue = Issue.objects.create(project=project, name="Dynamic single member item")
        WorkItemPropertyValue.objects.create(
            issue=issue,
            property=property_instance,
            project=project,
            value=str(member.id),
        )

        member.display_name = "Renamed Single Member"
        member.save(update_fields=["display_name"])

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/search-issues/",
            {"search": "Renamed Single Member"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert {str(item["id"]) for item in response.data} == {str(issue.id)}

        issue = Issue.objects.filter(id=issue.id).prefetch_related("work_item_property_values__property__options").get()
        assert IssueExportSerializer(issue).data["custom_properties"] == {"Owner": "Renamed Single Member"}

    def test_member_multi_select_search_and_export_use_current_display_name(
        self,
        session_client,
        workspace,
        project,
    ):
        member = User.objects.create_user(
            email="dynamic-member@plane.so",
            username="dynamic-member",
            password="test-password",
            display_name="Initial Member Name",
        )
        ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Reviewers",
            property_type="MULTI_SELECT",
            select_source="MEMBERS",
        )
        issue = Issue.objects.create(project=project, name="Dynamic member item")
        WorkItemPropertyValue.objects.create(
            issue=issue,
            property=property_instance,
            project=project,
            value=[str(member.id)],
        )

        member.display_name = "Renamed Member"
        member.save(update_fields=["display_name"])

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/search-issues/",
            {"search": "Renamed Member"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert {str(item["id"]) for item in response.data} == {str(issue.id)}

        issue = Issue.objects.filter(id=issue.id).prefetch_related("work_item_property_values__property__options").get()
        assert IssueExportSerializer(issue).data["custom_properties"] == {"Reviewers": ["Renamed Member"]}

    def test_issue_list_includes_property_values(self, session_client, workspace, project):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Customer",
            property_type="SHORT_TEXT",
        )
        issue = Issue.objects.create(project=project, name="Listed item")
        WorkItemPropertyValue.objects.create(
            issue=issue,
            property=property_instance,
            project=project,
            value="Acme",
        )

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/list/",
            {"issues": str(issue.id)},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data[0]["property_values"] == {str(property_instance.id): "Acme"}

    def test_issue_search_matches_text_property_and_select_option(
        self,
        session_client,
        workspace,
        project,
    ):
        text_property = ProjectWorkItemProperty.objects.create(
            project=project,
            name="External reference",
            property_type="SHORT_TEXT",
        )
        select_property = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Customer tier",
            property_type="SINGLE_SELECT",
        )
        option = ProjectWorkItemPropertyOption.objects.create(
            id=uuid4(),
            project=project,
            property=select_property,
            name="Enterprise",
        )
        text_issue = Issue.objects.create(project=project, name="First")
        select_issue = Issue.objects.create(project=project, name="Second")
        WorkItemPropertyValue.objects.create(
            issue=text_issue,
            property=text_property,
            project=project,
            value="REF-ALPHA-42",
        )
        WorkItemPropertyValue.objects.create(
            issue=select_issue,
            property=select_property,
            project=project,
            value=str(option.id),
        )
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/search-issues/"

        response = session_client.get(url, {"search": "ALPHA"})
        assert response.status_code == status.HTTP_200_OK
        assert {str(item["id"]) for item in response.data} == {str(text_issue.id)}

        response = session_client.get(url, {"search": "Enterprise"})
        assert response.status_code == status.HTTP_200_OK
        assert {str(item["id"]) for item in response.data} == {str(select_issue.id)}

    def test_export_uses_property_and_option_names(self, project):
        select_property = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Customer tier",
            property_type="MULTI_SELECT",
        )
        first_option = ProjectWorkItemPropertyOption.objects.create(
            project=project,
            property=select_property,
            name="Standard",
        )
        second_option = ProjectWorkItemPropertyOption.objects.create(
            project=project,
            property=select_property,
            name="Premium",
        )
        issue = Issue.objects.create(project=project, name="Exported")
        WorkItemPropertyValue.objects.create(
            issue=issue,
            property=select_property,
            project=project,
            value=[str(first_option.id), str(second_option.id)],
        )
        issue = Issue.objects.filter(id=issue.id).prefetch_related("work_item_property_values__property__options").get()

        data = IssueExportSerializer(issue).data

        assert data["custom_properties"] == {"Customer tier": ["Standard", "Premium"]}

    def test_issue_list_filters_all_custom_property_types(self, session_client, workspace, project):
        property_types = {
            "SHORT_TEXT": "Alpha customer",
            "LONG_TEXT": "First line\nSecond line",
            "NUMBER": 42.5,
            "DATE": "2026-08-06",
            "CHECKBOX": True,
        }
        properties = {
            property_type: ProjectWorkItemProperty.objects.create(
                project=project,
                name=f"Filter {property_type}",
                property_type=property_type,
            )
            for property_type in property_types
        }
        single_property = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Filter single select",
            property_type="SINGLE_SELECT",
        )
        single_option = ProjectWorkItemPropertyOption.objects.create(
            project=project,
            property=single_property,
            name="Enterprise",
        )
        multi_property = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Filter multi select",
            property_type="MULTI_SELECT",
        )
        multi_option = ProjectWorkItemPropertyOption.objects.create(
            project=project,
            property=multi_property,
            name="North",
        )
        matching_issue = Issue.objects.create(project=project, name="Matches every custom filter")
        non_matching_issue = Issue.objects.create(project=project, name="Does not match")
        for property_type, value in property_types.items():
            WorkItemPropertyValue.objects.create(
                issue=matching_issue,
                property=properties[property_type],
                project=project,
                value=value,
            )
        WorkItemPropertyValue.objects.create(
            issue=matching_issue,
            property=single_property,
            project=project,
            value=str(single_option.id),
        )
        WorkItemPropertyValue.objects.create(
            issue=matching_issue,
            property=multi_property,
            project=project,
            value=[str(multi_option.id)],
        )

        filters = {
            "and": [
                {f"customproperty_{properties['SHORT_TEXT'].id}__icontains": "alpha"},
                {f"customproperty_{properties['LONG_TEXT'].id}__icontains": "second"},
                {f"customproperty_{properties['NUMBER'].id}__range": [40, 45]},
                {f"customproperty_{properties['DATE'].id}__range": ["2026-08-01", "2026-08-10"]},
                {f"customproperty_{properties['CHECKBOX'].id}__exact": True},
                {f"customproperty_{single_property.id}__in": [str(single_option.id)]},
                {f"customproperty_{multi_property.id}__in": [str(multi_option.id)]},
            ]
        }
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/list/",
            {
                "issues": f"{matching_issue.id},{non_matching_issue.id}",
                "filters": json.dumps(filters),
            },
        )

        assert response.status_code == status.HTTP_200_OK
        issue_ids = {str(issue["id"]) for issue in response.data}
        assert issue_ids == {str(matching_issue.id)}

    def test_custom_property_filter_rejects_property_from_another_project(
        self,
        session_client,
        workspace,
        project,
    ):
        other_project = Project.objects.create(
            name="Other project",
            identifier="OTHER",
            workspace=workspace,
        )
        foreign_property = ProjectWorkItemProperty.objects.create(
            project=other_project,
            name="Foreign filter",
            property_type="SHORT_TEXT",
        )

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/list/",
            {
                "issues": str(uuid4()),
                "filters": json.dumps({f"customproperty_{foreign_property.id}__exact": "not allowed"}),
            },
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "invalid_custom_property"

    def test_issue_list_groups_by_single_select_custom_property(self, session_client, workspace, project):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Customer segment",
            property_type="SINGLE_SELECT",
        )
        option = ProjectWorkItemPropertyOption.objects.create(
            project=project,
            property=property_instance,
            name="Enterprise",
        )
        grouped_issue = Issue.objects.create(project=project, name="Grouped item")
        ungrouped_issue = Issue.objects.create(project=project, name="Ungrouped item")
        WorkItemPropertyValue.objects.create(
            issue=grouped_issue,
            property=property_instance,
            project=project,
            value=str(option.id),
        )

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/",
            {"group_by": f"customproperty_{property_instance.id}"},
        )

        assert response.status_code == status.HTTP_200_OK
        grouped_results = response.data["results"]
        assert str(option.id) in grouped_results
        assert "None" in grouped_results
        assert {str(item["id"]) for item in grouped_results[str(option.id)]["results"]} == {str(grouped_issue.id)}
        assert {str(item["id"]) for item in grouped_results["None"]["results"]} == {str(ungrouped_issue.id)}
