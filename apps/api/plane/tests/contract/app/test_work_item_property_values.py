# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.


import pytest
from rest_framework import status

from plane.db.models import (
    Cycle,
    CycleIssue,
    DraftIssue,
    Issue,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    ProjectWorkItemFieldConfiguration,
    ProjectWorkItemProperty,
    State,
    WorkItemPropertyValue,
    get_default_work_item_field_configuration,
)


def _issue_url(workspace, project, issue_id=None):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    return f"{base}{issue_id}/" if issue_id else base


def _draft_url(workspace):
    return f"/api/workspaces/{workspace.slug}/draft-issues/"


def _draft_conversion_url(workspace, draft):
    return f"/api/workspaces/{workspace.slug}/draft-to-issue/{draft.id}/"


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Property Values",
        identifier="VALUES",
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
class TestWorkItemPropertyValues:
    def test_required_property_is_enforced_and_persisted(
        self,
        session_client,
        workspace,
        project,
    ):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Reference",
            property_type="SHORT_TEXT",
            is_required=True,
        )

        response = session_client.post(
            _issue_url(workspace, project),
            {"name": "Missing property"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert str(property_instance.id) in response.data["work_item_fields"]["properties"]

        response = session_client.post(
            _issue_url(workspace, project),
            {
                "name": "Complete item",
                "property_values": {str(property_instance.id): "REF-100"},
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        value = WorkItemPropertyValue.objects.get(
            issue_id=response.data["id"],
            property=property_instance,
        )
        assert value.value == "REF-100"
        assert response.data["property_values"][str(property_instance.id)] == "REF-100"

    def test_default_value_is_applied(
        self,
        session_client,
        workspace,
        project,
    ):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Score",
            property_type="NUMBER",
            is_required=True,
            default_value=10,
        )
        response = session_client.post(
            _issue_url(workspace, project),
            {"name": "Uses default"},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert (
            WorkItemPropertyValue.objects.get(
                issue_id=response.data["id"],
                property=property_instance,
            ).value
            == 10
        )

    def test_create_accepts_null_module_ids_from_default_web_form(
        self,
        session_client,
        workspace,
        project,
    ):
        response = session_client.post(
            _issue_url(workspace, project),
            {
                "name": "No module selected",
                "cycle_id": None,
                "module_ids": None,
                "property_values": {},
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["module_ids"] == []
        assert ModuleIssue.objects.filter(issue_id=response.data["id"]).exists() is False

    def test_invalid_property_type_is_rejected_atomically(
        self,
        session_client,
        workspace,
        project,
    ):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Amount",
            property_type="NUMBER",
        )
        response = session_client.post(
            _issue_url(workspace, project),
            {
                "name": "Invalid",
                "property_values": {str(property_instance.id): "not-a-number"},
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Issue.objects.filter(name="Invalid").exists() is False

    def test_existing_item_must_satisfy_new_required_property_on_next_save(
        self,
        session_client,
        workspace,
        project,
    ):
        issue = Issue.objects.create(
            project=project,
            name="Legacy",
        )
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="New required value",
            property_type="LONG_TEXT",
            is_required=True,
        )

        response = session_client.patch(
            _issue_url(workspace, project, issue.id),
            {"name": "Legacy edited"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        response = session_client.patch(
            _issue_url(workspace, project, issue.id),
            {
                "name": "Legacy completed",
                "property_values": {str(property_instance.id): "Now filled"},
            },
            format="json",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        issue.refresh_from_db()
        assert issue.name == "Legacy completed"

    def test_required_builtin_cycle_and_module_are_saved_in_create_request(
        self,
        session_client,
        workspace,
        project,
        create_user,
    ):
        configuration = get_default_work_item_field_configuration()
        configuration["cycle"]["required"] = True
        configuration["module"]["required"] = True
        ProjectWorkItemFieldConfiguration.objects.create(
            project=project,
            built_in_fields=configuration,
        )
        cycle = Cycle.objects.create(
            project=project,
            name="Cycle A",
            owned_by=create_user,
        )
        module = Module.objects.create(
            project=project,
            name="Module A",
        )

        response = session_client.post(
            _issue_url(workspace, project),
            {
                "name": "Related item",
                "cycle_id": str(cycle.id),
                "module_ids": [str(module.id)],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert CycleIssue.objects.filter(
            issue_id=response.data["id"],
            cycle=cycle,
        ).exists()
        assert ModuleIssue.objects.filter(
            issue_id=response.data["id"],
            module=module,
        ).exists()

    def test_required_builtin_priority_rejects_none(
        self,
        session_client,
        workspace,
        project,
    ):
        configuration = get_default_work_item_field_configuration()
        configuration["priority"]["required"] = True
        ProjectWorkItemFieldConfiguration.objects.create(
            project=project,
            built_in_fields=configuration,
        )

        response = session_client.post(
            _issue_url(workspace, project),
            {"name": "No priority", "priority": "none"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        response = session_client.post(
            _issue_url(workspace, project),
            {"name": "Has priority", "priority": "high"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED


@pytest.mark.contract
@pytest.mark.django_db
class TestDraftPropertyValues:
    def test_draft_can_be_incomplete_but_conversion_is_enforced(
        self,
        session_client,
        workspace,
        project,
    ):
        property_instance = ProjectWorkItemProperty.objects.create(
            project=project,
            name="Required at conversion",
            property_type="SHORT_TEXT",
            is_required=True,
        )
        response = session_client.post(
            _draft_url(workspace),
            {
                "project_id": str(project.id),
                "name": "Incomplete draft",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        draft = DraftIssue.objects.get(id=response.data["id"])

        response = session_client.post(
            _draft_conversion_url(workspace, draft),
            {"name": "Converted without value"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert DraftIssue.objects.filter(id=draft.id).exists()

        response = session_client.post(
            _draft_conversion_url(workspace, draft),
            {
                "name": "Converted with value",
                "property_values": {
                    str(property_instance.id): "complete",
                },
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert DraftIssue.objects.filter(id=draft.id).exists() is False
        assert WorkItemPropertyValue.objects.filter(
            issue_id=response.data["id"],
            property=property_instance,
            value="complete",
        ).exists()
