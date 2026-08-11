# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import pytest

from plane.app.serializers.user import UserLiteSerializer, UserSerializer
from plane.db.models import Project, ProjectMember, User, WorkspaceMember


@pytest.mark.contract
@pytest.mark.django_db
class TestUserFullName:
    def test_display_name_is_derived_and_previous_alias_remains_searchable(self):
        user = User.objects.create(
            email=f"name-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
            first_name="  Ada ",
            last_name=" Lovelace  ",
            display_name="ada.engineer",
        )

        assert user.first_name == "Ada"
        assert user.last_name == "Lovelace"
        assert user.display_name == "Ada Lovelace"
        assert user.legacy_display_name == "ada.engineer"
        assert UserLiteSerializer(user).data["legacy_display_name"] == "ada.engineer"

    def test_profile_update_cannot_set_an_independent_display_name(self):
        user = User.objects.create(
            email=f"profile-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
            first_name="Grace",
            last_name="Hopper",
        )
        serializer = UserSerializer(
            user,
            data={
                "first_name": "Amazing",
                "last_name": "Grace",
                "display_name": "manual-alias",
            },
            partial=True,
        )

        assert serializer.is_valid(), serializer.errors
        serializer.save()
        user.refresh_from_db()

        assert user.display_name == "Amazing Grace"
        assert user.legacy_display_name == "Grace Hopper"

    def test_first_name_cannot_be_cleared_through_profile_api(self):
        user = User.objects.create(
            email=f"required-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
            first_name="Required",
        )
        serializer = UserSerializer(user, data={"first_name": "   "}, partial=True)

        assert not serializer.is_valid()
        assert "first_name" in serializer.errors

    def test_mention_search_supports_legacy_alias_email_and_duplicate_names(
        self, session_client, workspace, create_user
    ):
        project = Project.objects.create(
            name="Names",
            identifier="NAM",
            workspace=workspace,
            created_by=create_user,
        )
        ProjectMember.objects.create(
            workspace=workspace,
            project=project,
            member=create_user,
            role=20,
        )
        duplicate = User.objects.create(
            email=f"duplicate-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
            first_name=create_user.first_name,
            last_name=create_user.last_name,
            display_name="former-nickname",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=duplicate, role=15)
        ProjectMember.objects.create(
            workspace=workspace,
            project=project,
            member=duplicate,
            role=15,
        )

        duplicate_response = session_client.get(
            f"/api/workspaces/{workspace.slug}/entity-search/"
            f"?query_type=user_mention&query={create_user.first_name}&project_id={project.id}&count=20"
        )
        assert duplicate_response.status_code == 200
        duplicate_results = duplicate_response.data["user_mention"]
        assert len(duplicate_results) == 2
        assert {item["member__name_count"] for item in duplicate_results} == {2}
        assert all(item["member__email"] for item in duplicate_results)

        alias_response = session_client.get(
            f"/api/workspaces/{workspace.slug}/entity-search/"
            f"?query_type=user_mention&query=former-nickname&project_id={project.id}&count=20"
        )
        assert alias_response.status_code == 200
        assert [item["member__id"] for item in alias_response.data["user_mention"]] == [duplicate.id]
