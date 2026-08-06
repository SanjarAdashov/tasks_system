# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Project,
    ProjectMember,
    ProjectWorkItemProperty,
    ProjectWorkItemPropertyOption,
    User,
    WorkspaceMember,
)


def _configuration_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-item-fields/configuration/"


def _properties_url(workspace, project, property_id=None):
    base_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-item-fields/properties/"
    return f"{base_url}{property_id}/" if property_id else base_url


def _make_user(email):
    user = User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="test-password",
    )
    return user


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Field Configuration",
        identifier="FIELDS",
        workspace=workspace,
    )
    ProjectMember.objects.create(
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def project_member(workspace, project):
    user = _make_user("field-member@plane.so")
    WorkspaceMember.objects.create(
        workspace=workspace,
        member=user,
        role=15,
        is_active=True,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=15,
        is_active=True,
    )
    return user


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectWorkItemFieldConfiguration:
    def test_project_member_can_read_but_cannot_update(
        self,
        workspace,
        project,
        project_member,
    ):
        client = APIClient()
        client.force_authenticate(user=project_member)
        url = _configuration_url(workspace, project)

        response = client.get(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["built_in_fields"]["project"] == {
            "visible": True,
            "required": True,
        }

        response = client.patch(
            url,
            {"built_in_fields": {"start_date": {"visible": False}}},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_project_admin_can_hide_field_and_required_is_cleared(
        self,
        session_client,
        workspace,
        project,
    ):
        response = session_client.patch(
            _configuration_url(workspace, project),
            {
                "built_in_fields": {
                    "start_date": {
                        "visible": False,
                        "required": True,
                    }
                }
            },
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["built_in_fields"]["start_date"] == {
            "visible": False,
            "required": False,
        }

    @pytest.mark.parametrize(
        "field_key",
        [
            "project",
            "title",
            "description",
            "state",
            "priority",
            "assignees",
            "labels",
        ],
    )
    def test_locked_visible_fields_cannot_be_hidden(
        self,
        field_key,
        session_client,
        workspace,
        project,
    ):
        response = session_client.patch(
            _configuration_url(workspace, project),
            {"built_in_fields": {field_key: {"visible": False}}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectWorkItemProperty:
    def test_admin_can_create_project_member_multi_select_without_options(
        self,
        session_client,
        workspace,
        project,
        project_member,
    ):
        response = session_client.post(
            _properties_url(workspace, project),
            {
                "name": "Reviewers",
                "property_type": "MULTI_SELECT",
                "multi_select_source": "MEMBERS",
                "default_value": [str(project_member.id)],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["multi_select_source"] == "MEMBERS"
        assert response.data["options"] == []

    def test_project_member_multi_select_rejects_manual_options(
        self,
        session_client,
        workspace,
        project,
    ):
        response = session_client.post(
            _properties_url(workspace, project),
            {
                "name": "Invalid reviewers",
                "property_type": "MULTI_SELECT",
                "multi_select_source": "MEMBERS",
                "options": [{"id": str(uuid4()), "name": "Manual value"}],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "options" in response.data

    def test_admin_can_create_select_property_and_member_can_list_it(
        self,
        session_client,
        workspace,
        project,
        project_member,
    ):
        first_option_id = uuid4()
        second_option_id = uuid4()
        response = session_client.post(
            _properties_url(workspace, project),
            {
                "name": "Customer tier",
                "property_type": "SINGLE_SELECT",
                "is_required": True,
                "default_value": str(first_option_id),
                "options": [
                    {
                        "id": str(first_option_id),
                        "name": "Standard",
                        "sort_order": 100,
                    },
                    {
                        "id": str(second_option_id),
                        "name": "Premium",
                        "sort_order": 200,
                    },
                ],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        property_instance = ProjectWorkItemProperty.objects.get(id=response.data["id"])
        assert property_instance.project == project
        assert property_instance.workspace == workspace
        assert property_instance.options.count() == 2

        member_client = APIClient()
        member_client.force_authenticate(user=project_member)
        response = member_client.get(_properties_url(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data[0]["name"] == "Customer tier"

    def test_non_admin_cannot_create_property(
        self,
        workspace,
        project,
        project_member,
    ):
        client = APIClient()
        client.force_authenticate(user=project_member)
        response = client.post(
            _properties_url(workspace, project),
            {
                "name": "Forbidden",
                "property_type": "SHORT_TEXT",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_invalid_select_default_is_rejected(
        self,
        session_client,
        workspace,
        project,
    ):
        response = session_client.post(
            _properties_url(workspace, project),
            {
                "name": "Invalid default",
                "property_type": "MULTI_SELECT",
                "default_value": [str(uuid4())],
                "options": [
                    {
                        "id": str(uuid4()),
                        "name": "Known",
                    }
                ],
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_archives_property_and_preserves_options(
        self,
        session_client,
        workspace,
        project,
    ):
        option_id = uuid4()
        create_response = session_client.post(
            _properties_url(workspace, project),
            {
                "name": "Archive me",
                "property_type": "SINGLE_SELECT",
                "options": [
                    {
                        "id": str(option_id),
                        "name": "Historical",
                    }
                ],
            },
            format="json",
        )
        property_id = create_response.data["id"]

        response = session_client.delete(_properties_url(workspace, project, property_id))
        assert response.status_code == status.HTTP_204_NO_CONTENT

        property_instance = ProjectWorkItemProperty.objects.get(id=property_id)
        assert property_instance.archived_at is not None
        assert ProjectWorkItemPropertyOption.objects.filter(
            property=property_instance,
            id=option_id,
        ).exists()
