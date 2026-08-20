import json
import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.bgtasks.project_announcement_task import dispatch_project_announcement
from plane.db.models import (
    Notification,
    Project,
    ProjectAnnouncement,
    ProjectAnnouncementRecipient,
    ProjectMember,
    User,
    WorkspaceMember,
)


def create_member(workspace, project, *, blocked=False, active=True):
    user = User.objects.create_user(
        email=f"announcement-{uuid.uuid4().hex}@example.com",
        username=uuid.uuid4().hex,
        first_name="Project",
        last_name="Member",
    )
    if blocked:
        from django.utils import timezone

        user.blocked_at = timezone.now()
        user.save(update_fields=["blocked_at", "updated_at"])
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=active)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=15,
        is_active=active,
    )
    return user


@pytest.fixture
def announcement_project(workspace, create_user):
    project = Project(name="Announcements", identifier=f"ANN{uuid.uuid4().hex[:4]}", workspace=workspace)
    project.save(created_by_id=create_user.id)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectAnnouncements:
    def test_admin_can_send_to_active_members_only(
        self,
        mocker,
        session_client,
        create_user,
        workspace,
        announcement_project,
    ):
        mocker.patch("plane.app.views.project.announcement.dispatch_project_announcement.delay")
        active_member = create_member(workspace, announcement_project)
        create_member(workspace, announcement_project, blocked=True)
        create_member(workspace, announcement_project, active=False)

        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{announcement_project.id}/announcements/",
            {
                "title": "Planned maintenance",
                "content_html": "<p>The service will be updated tonight.</p>",
                "announcement_type": "standard",
                "all_members": "true",
                "user_ids": json.dumps([]),
                "group_ids": json.dumps([]),
            },
            format="multipart",
        )

        assert response.status_code == status.HTTP_201_CREATED
        announcement = ProjectAnnouncement.objects.get(pk=response.data["id"])
        assert set(announcement.recipients.values_list("user_id", flat=True)) == {
            create_user.id,
            active_member.id,
        }
        assert (
            Notification.objects.filter(entity_name="project_announcement", entity_identifier=announcement.id).count()
            == 2
        )
        detail = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{announcement_project.id}/announcements/{announcement.id}/"
        )
        assert detail.status_code == status.HTTP_200_OK
        assert detail.data["statistics"]["total"] == 2
        assert len(detail.data["recipients"]) == 2

        email_preferences = session_client.get("/api/users/me/notification-preferences/")
        assert email_preferences.status_code == status.HTTP_200_OK
        assert email_preferences.data["project_announcement"] is True
        telegram_preferences = session_client.get("/api/users/me/telegram/")
        assert telegram_preferences.status_code == status.HTTP_200_OK
        assert telegram_preferences.data["preferences"]["project_announcement"] is True

        mocker.patch(
            "plane.bgtasks.project_announcement_task._send_email",
            return_value=(ProjectAnnouncementRecipient.DeliveryStatus.SENT, ""),
        )
        mocker.patch("plane.bgtasks.project_announcement_task.enqueue_telegram_notifications", return_value=[])
        dispatch_project_announcement(str(announcement.id))
        assert set(announcement.recipients.values_list("email_status", flat=True)) == {"sent"}
        assert set(announcement.recipients.values_list("telegram_status", flat=True)) == {"skipped"}

    def test_important_dismissal_does_not_mark_read_and_opening_does(
        self,
        mocker,
        session_client,
        workspace,
        announcement_project,
    ):
        mocker.patch("plane.app.views.project.announcement.dispatch_project_announcement.delay")
        recipient = create_member(workspace, announcement_project)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{announcement_project.id}/announcements/",
            {
                "title": "Required update",
                "content_html": "<p>Please review this notice.</p>",
                "announcement_type": "important",
                "all_members": "false",
                "user_ids": json.dumps([str(recipient.id)]),
                "group_ids": json.dumps([]),
            },
            format="multipart",
        )
        assert created.status_code == status.HTTP_201_CREATED
        announcement_id = created.data["id"]

        client = APIClient()
        client.force_authenticate(recipient)
        listed = client.get(f"/api/workspaces/{workspace.slug}/users/project-announcements/important/")
        assert listed.status_code == status.HTTP_200_OK
        assert [item["id"] for item in listed.data] == [announcement_id]

        dismissed = client.post(
            f"/api/workspaces/{workspace.slug}/users/project-announcements/{announcement_id}/dismiss/",
            {},
            format="json",
        )
        assert dismissed.status_code == status.HTTP_200_OK
        row = ProjectAnnouncementRecipient.objects.get(announcement_id=announcement_id, user=recipient)
        assert row.read_at is None
        assert row.modal_dismiss_count == 1

        opened = client.get(f"/api/workspaces/{workspace.slug}/users/project-announcements/{announcement_id}/")
        assert opened.status_code == status.HTTP_200_OK
        row.refresh_from_db()
        assert row.read_at is not None
        assert row.notification.read_at is not None
        assert client.get(f"/api/workspaces/{workspace.slug}/users/project-announcements/important/").data == []

    def test_recipient_snapshot_survives_membership_removal_and_non_admin_cannot_send(
        self,
        mocker,
        session_client,
        workspace,
        announcement_project,
    ):
        mocker.patch("plane.app.views.project.announcement.dispatch_project_announcement.delay")
        recipient = create_member(workspace, announcement_project)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{announcement_project.id}/announcements/",
            {
                "title": "Permanent notice",
                "content_html": "<p>This remains available to its original recipients.</p>",
                "announcement_type": "standard",
                "all_members": "false",
                "user_ids": json.dumps([str(recipient.id)]),
                "group_ids": json.dumps([]),
            },
            format="multipart",
        )
        announcement_id = created.data["id"]

        client = APIClient()
        client.force_authenticate(recipient)
        send_url = f"/api/workspaces/{workspace.slug}/projects/{announcement_project.id}/announcements/"
        assert client.post(send_url, {}, format="json").status_code == status.HTTP_403_FORBIDDEN

        ProjectMember.objects.filter(project=announcement_project, member=recipient).delete()
        detail = client.get(f"/api/workspaces/{workspace.slug}/users/project-announcements/{announcement_id}/")
        assert detail.status_code == status.HTTP_200_OK
        assert detail.data["title"] == "Permanent notice"
        assert session_client.delete(f"{send_url}{announcement_id}/").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
