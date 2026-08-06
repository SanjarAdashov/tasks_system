# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    Session,
    User,
    UserAccessLog,
    Project,
    ProjectMember,
    Workspace,
    WorkspaceMember,
)
from plane.app.serializers.user import UserLiteSerializer
from plane.app.serializers.issue import IssueCreateSerializer
from plane.license.models import Instance, InstanceAdmin


def create_named_user(label, *, is_active=True, is_bot=False):
    unique = uuid.uuid4().hex[:8]
    user = User.objects.create(
        email=f"{label}-{unique}@plane.so",
        username=f"{label}-{unique}",
        first_name=label.title(),
        last_name="User",
        is_active=is_active,
        is_bot=is_bot,
    )
    user.set_password("original-password")
    user.save()
    return user


def create_instance(admin):
    instance = Instance.objects.create(
        instance_name="Test Plane",
        instance_id=uuid.uuid4().hex,
        current_version="1.4.0",
        last_checked_at=timezone.now(),
    )
    InstanceAdmin.objects.create(instance=instance, user=admin)
    return instance


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceUserAccess:
    def test_instance_admin_can_block_and_unblock_without_losing_membership(self):
        admin = create_named_user("admin")
        target = create_named_user("member")
        create_instance(admin)

        workspace = Workspace.objects.create(
            name="Access Test",
            slug=f"access-test-{uuid.uuid4().hex[:8]}",
            owner=admin,
        )
        membership = WorkspaceMember.objects.create(
            workspace=workspace,
            member=target,
            role=15,
        )
        project = Project.objects.create(
            name="Access Project",
            identifier="ACP",
            workspace=workspace,
            created_by=admin,
        )
        ProjectMember.objects.create(project=project, member=target, role=15)
        api_token = APIToken.objects.create(
            user=target,
            label="Existing token",
            token=f"token-{uuid.uuid4().hex}",
        )
        Session.objects.create(
            session_key=uuid.uuid4().hex,
            session_data="",
            expire_date=timezone.now() + timedelta(days=1),
            user_id=str(target.id),
        )

        client = APIClient()
        client.force_authenticate(user=admin)
        block_response = client.post(
            f"/api/instances/users/{target.id}/block/",
            {"reason": "Employment ended"},
            format="json",
        )

        assert block_response.status_code == status.HTTP_200_OK
        assert block_response.data["status"] == "blocked"
        assert block_response.data["blocked_reason"] == "Employment ended"

        target.refresh_from_db()
        membership.refresh_from_db()
        api_token.refresh_from_db()
        assert target.is_active is False
        assert UserLiteSerializer(target).data["is_active"] is False
        assert target.blocked_at is not None
        assert target.blocked_by_id == admin.id
        assert target.check_password("original-password")
        assert membership.is_active is True
        assert membership.role == 15
        assert api_token.is_active is False
        assert not Session.objects.filter(user_id=str(target.id)).exists()
        assert UserAccessLog.objects.filter(
            user=target,
            actor=admin,
            action=UserAccessLog.Action.BLOCKED,
            reason="Employment ended",
        ).exists()

        blocked_assignment = IssueCreateSerializer(context={"project_id": project.id}).validate(
            {"assignee_ids": [target]}
        )
        assert list(blocked_assignment["assignee_ids"]) == []

        unblock_response = client.post(
            f"/api/instances/users/{target.id}/unblock/",
            {"reason": "Access approved again"},
            format="json",
        )

        assert unblock_response.status_code == status.HTTP_200_OK
        assert unblock_response.data["status"] == "active"

        target.refresh_from_db()
        membership.refresh_from_db()
        api_token.refresh_from_db()
        assert target.is_active is True
        assert UserLiteSerializer(target).data["is_active"] is True
        assert target.blocked_at is None
        assert target.blocked_by is None
        assert target.blocked_reason is None
        assert target.check_password("original-password")
        assert membership.is_active is True
        assert membership.role == 15
        assert api_token.is_active is False
        assert UserAccessLog.objects.filter(
            user=target,
            actor=admin,
            action=UserAccessLog.Action.UNBLOCKED,
            reason="Access approved again",
        ).exists()

        restored_assignment = IssueCreateSerializer(context={"project_id": project.id}).validate(
            {"assignee_ids": [target]}
        )
        assert list(restored_assignment["assignee_ids"]) == [target.id]

    def test_block_requires_a_reason(self):
        admin = create_named_user("admin")
        target = create_named_user("member")
        create_instance(admin)
        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.post(
            f"/api/instances/users/{target.id}/block/",
            {},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"]["code"] == "BLOCK_REASON_REQUIRED"
        target.refresh_from_db()
        assert target.is_active is True
        assert target.blocked_at is None

    def test_instance_admin_cannot_block_self(self):
        admin = create_named_user("admin")
        create_instance(admin)
        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.post(
            f"/api/instances/users/{admin.id}/block/",
            {"reason": "Should be rejected"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"]["code"] == "CANNOT_BLOCK_SELF"
        admin.refresh_from_db()
        assert admin.is_active is True

    def test_non_instance_admin_cannot_manage_user_access(self):
        admin = create_named_user("admin")
        member = create_named_user("member")
        target = create_named_user("target")
        create_instance(admin)
        client = APIClient()
        client.force_authenticate(user=member)

        response = client.post(
            f"/api/instances/users/{target.id}/block/",
            {"reason": "Not authorized"},
            format="json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        target.refresh_from_db()
        assert target.is_active is True

    def test_user_list_distinguishes_blocked_and_inactive_accounts(self):
        admin = create_named_user("admin")
        blocked = create_named_user("blocked")
        inactive = create_named_user("inactive", is_active=False)
        bot = create_named_user("service", is_bot=True)
        create_instance(admin)

        blocked.is_active = False
        blocked.blocked_at = timezone.now()
        blocked.blocked_by = admin
        blocked.blocked_reason = "Security review"
        blocked.save()

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.get("/api/instances/users/?per_page=100")

        assert response.status_code == status.HTTP_200_OK
        users = {str(item["id"]): item for item in response.data["results"]}
        assert response.data["extra_stats"] == {
            "total_users": 3,
            "active_users": 1,
            "blocked_users": 1,
        }
        assert users[str(admin.id)]["status"] == "active"
        assert users[str(admin.id)]["is_instance_admin"] is True
        assert users[str(blocked.id)]["status"] == "blocked"
        assert users[str(inactive.id)]["status"] == "inactive"
        assert str(bot.id) not in users

        filtered_response = client.get(f"/api/instances/users/?search={admin.email}&per_page=100")

        assert filtered_response.status_code == status.HTTP_200_OK
        assert filtered_response.data["total_results"] == 1
        assert filtered_response.data["extra_stats"] == {
            "total_users": 3,
            "active_users": 1,
            "blocked_users": 1,
        }
