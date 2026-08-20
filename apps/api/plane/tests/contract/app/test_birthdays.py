from datetime import date, timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import User, WorkspaceHoliday, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin


def make_user(email, first_name, *, birthday=None):
    return User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="test-password",
        first_name=first_name,
        last_name="Birthday",
        date_of_birth=birthday,
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestBirthdayProfiles:
    def test_user_can_acknowledge_annual_greeting(self, session_client, create_user):
        today = timezone.localdate()
        create_user.date_of_birth = date(1990, today.month, today.day)
        create_user.save(update_fields=["date_of_birth"])

        greeting = session_client.get("/api/users/me/birthday-greeting/")
        assert greeting.status_code == status.HTTP_200_OK
        assert greeting.data["is_birthday"] is True
        assert greeting.data["should_show"] is True
        assert create_user.first_name in greeting.data["message"]

        acknowledged = session_client.post("/api/users/me/birthday-greeting/", {}, format="json")
        assert acknowledged.status_code == status.HTTP_200_OK
        repeated = session_client.get("/api/users/me/birthday-greeting/")
        assert repeated.data["is_birthday"] is True
        assert repeated.data["should_show"] is False
        assert create_user.first_name in repeated.data["message"]

    def test_workspace_peers_see_month_day_while_admin_sees_full_date(self, session_client, workspace):
        birthday = date(1992, 8, 21)
        peer = make_user("birthday-peer@example.com", "Peer", birthday=birthday)
        ordinary = make_user("ordinary-peer@example.com", "Ordinary")
        WorkspaceMember.objects.create(workspace=workspace, member=peer, role=15, is_active=True)
        WorkspaceMember.objects.create(workspace=workspace, member=ordinary, role=15, is_active=True)

        admin_response = session_client.get(f"/api/workspaces/{workspace.slug}/members/")
        admin_peer = next(item for item in admin_response.data if str(item["member"]["id"]) == str(peer.id))
        assert admin_peer["member"]["date_of_birth"] == "1992-08-21"
        assert admin_peer["member"]["birthday"] == "08-21"

        member_client = APIClient()
        member_client.force_authenticate(user=ordinary)
        member_response = member_client.get(f"/api/workspaces/{workspace.slug}/members/")
        member_peer = next(item for item in member_response.data if str(item["member"]["id"]) == str(peer.id))
        assert "date_of_birth" not in member_peer["member"]
        assert member_peer["member"]["birthday"] == "08-21"

    def test_instance_admin_can_edit_identity(self, create_user):
        instance = Instance.objects.create(
            instance_name="Birthday Test",
            instance_id=uuid4().hex,
            current_version="test",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=create_user)
        target = make_user("identity-target@example.com", "Old")
        client = APIClient()
        client.force_authenticate(user=create_user)

        response = client.patch(
            f"/api/instances/users/{target.id}/profile/",
            {"first_name": "New", "last_name": "Name", "date_of_birth": "1995-03-04"},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        target.refresh_from_db()
        assert (target.first_name, target.last_name, target.date_of_birth) == ("New", "Name", date(1995, 3, 4))


@pytest.mark.contract
@pytest.mark.django_db
class TestBirthdayCalendar:
    def test_calendar_range_includes_birthday_without_birth_year(self, session_client, create_user, workspace):
        today = timezone.localdate()
        create_user.date_of_birth = date(1985, today.month, today.day)
        create_user.save(update_fields=["date_of_birth"])

        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/calendar/meetings/",
            {
                "start": (timezone.now() - timedelta(days=1)).isoformat(),
                "end": (timezone.now() + timedelta(days=1)).isoformat(),
            },
        )

        assert response.status_code == status.HTTP_200_OK
        birthday = next(
            item for item in response.data["birthday_events"] if str(item["user"]["id"]) == str(create_user.id)
        )
        assert str(birthday["date"]) == today.isoformat()
        assert "date_of_birth" not in birthday["user"]

    def test_manual_workday_upserts_an_existing_override(self, session_client, workspace):
        workday = (timezone.localdate() + timedelta(days=3)).isoformat()
        url = f"/api/workspaces/{workspace.slug}/calendar/holidays/"
        first = session_client.post(
            url,
            {"date": workday, "name": "Working Saturday", "kind": "WORKDAY", "source": "MANUAL"},
            format="json",
        )
        second = session_client.post(
            url,
            {"date": workday, "name": "Special workday", "kind": "WORKDAY", "source": "MANUAL"},
            format="json",
        )

        assert first.status_code == status.HTTP_201_CREATED
        assert second.status_code == status.HTTP_200_OK
        assert WorkspaceHoliday.objects.filter(workspace=workspace, date=workday, source="MANUAL").count() == 1
        assert WorkspaceHoliday.objects.get(workspace=workspace, date=workday, source="MANUAL").name == "Special workday"
