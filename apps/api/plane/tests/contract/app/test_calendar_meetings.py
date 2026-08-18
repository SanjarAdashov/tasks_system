from datetime import timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.app.views.calendar import meeting_ics
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueSubscriber,
    Meeting,
    MeetingParticipant,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)
from plane.utils.calendar import read_signed_calendar_token, sign_participant_token


def make_user(email, first_name):
    return User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="test-password",
        first_name=first_name,
        last_name="Calendar",
    )


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="Calendar", identifier="CAL", workspace=workspace)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def member(workspace, project):
    user = make_user("calendar-member@example.com", "Member")
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
def observer(workspace, project):
    user = make_user("calendar-observer@example.com", "Observer")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=15,
        is_active=True,
    )
    return user


def meeting_url(workspace, meeting_id=None):
    base = f"/api/workspaces/{workspace.slug}/calendar/meetings/"
    return f"{base}{meeting_id}/" if meeting_id else base


def meeting_payload(project, **overrides):
    start = timezone.now() + timedelta(days=1)
    payload = {
        "project_id": str(project.id),
        "title": "Flight readiness review",
        "description": "Sensitive agenda",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(minutes=45)).isoformat(),
        "timezone": "Asia/Tashkent",
        "attendance_mode": "ONLINE",
        "participants": [],
        "reminder_minutes": [30, 10],
    }
    payload.update(overrides)
    return payload


@pytest.mark.contract
@pytest.mark.django_db
class TestMeetingTypes:
    def test_member_can_list_but_only_admin_can_create(self, session_client, workspace, project, member):
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/meeting-types/",
            {
                "name": "Planning",
                "color": "#16A34A",
                "default_duration_minutes": 45,
                "default_reminders": [30, 10],
                "is_default": True,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["is_default"] is True

        member_client = APIClient()
        member_client.force_authenticate(user=member)
        list_response = member_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/meeting-types/")
        assert list_response.status_code == status.HTTP_200_OK
        assert list_response.data[0]["name"] == "Planning"

        create_response = member_client.post(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/meeting-types/",
            {"name": "Forbidden"},
            format="json",
        )
        assert create_response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
@pytest.mark.django_db
class TestMeetings:
    def test_create_keeps_organizer_and_reminders(self, session_client, create_user, workspace, project):
        response = session_client.post(meeting_url(workspace), meeting_payload(project), format="json")
        assert response.status_code == status.HTTP_201_CREATED
        meeting = Meeting.objects.get(id=response.data["id"])
        assert meeting.organizer == create_user
        organizer_participant = meeting.participants.get(user=create_user, removed_at__isnull=True)
        assert organizer_participant.response_status == "ACCEPTED"
        assert sorted(meeting.reminders.values_list("minutes_before", flat=True)) == [10, 30]

    def test_all_day_meeting_uses_exclusive_end_date_in_ics(self, session_client, workspace, project):
        start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(
                project,
                starts_at=start.isoformat(),
                ends_at=(start + timedelta(days=1)).isoformat(),
                all_day=True,
            ),
            format="json",
        )

        assert created.status_code == status.HTTP_201_CREATED
        exported = meeting_ics(Meeting.objects.get(id=created.data["id"]))
        assert "DTSTART;VALUE=DATE:" in exported
        assert "DTEND;VALUE=DATE:" in exported

    def test_personal_meeting_rejects_internal_user_outside_workspace(self, session_client, workspace, project):
        outsider = make_user("calendar-outsider@example.com", "Outsider")
        response = session_client.post(
            meeting_url(workspace),
            meeting_payload(
                project,
                project_id=None,
                participants=[{"user_id": str(outsider.id)}],
            ),
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "participants" in response.data

    def test_availability_rejects_users_outside_workspace(self, session_client, workspace):
        outsider = make_user("calendar-availability-outsider@example.com", "Outsider")
        start = timezone.now() + timedelta(days=1)
        response = session_client.post(
            f"/api/workspaces/{workspace.slug}/calendar/availability/",
            {
                "user_ids": [str(outsider.id)],
                "start": start.isoformat(),
                "end": (start + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_normal_meeting_redacts_details_for_non_participant(self, session_client, workspace, project, observer):
        created = session_client.post(meeting_url(workspace), meeting_payload(project), format="json")
        observer_client = APIClient()
        observer_client.force_authenticate(user=observer)
        response = observer_client.get(meeting_url(workspace, created.data["id"]))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["detail_access"] is False
        assert "description" not in response.data
        assert "participant_details" not in response.data

    def test_restricted_meeting_is_hidden_from_non_participant(self, session_client, workspace, project, observer):
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(project, visibility="RESTRICTED"),
            format="json",
        )
        observer_client = APIClient()
        observer_client.force_authenticate(user=observer)
        response = observer_client.get(meeting_url(workspace, created.data["id"]))
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_participant_can_respond(self, session_client, workspace, project, member):
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(
                project,
                participants=[
                    {
                        "user_id": str(member.id),
                        "role": "REQUIRED",
                        "source": "EXPLICIT",
                    }
                ],
            ),
            format="json",
        )
        member_client = APIClient()
        member_client.force_authenticate(user=member)
        response = member_client.post(
            f"{meeting_url(workspace, created.data['id'])}response/",
            {"response_status": "ACCEPTED"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["response_status"] == "ACCEPTED"

    def test_public_response_page_uses_browser_language(self, session_client, workspace, project, member):
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(project, participants=[{"user_id": str(member.id)}]),
            format="json",
        )
        participant = MeetingParticipant.objects.get(meeting_id=created.data["id"], user=member)
        token = sign_participant_token(participant.id)
        assert read_signed_calendar_token(token)["participant_id"] == str(participant.id)
        assert MeetingParticipant.objects.filter(id=participant.id, removed_at__isnull=True).exists()

        response = APIClient().get(
            f"/api/calendar/public/respond/{token}/",
            {"format": "html"},
            HTTP_ACCEPT_LANGUAGE="uz-UZ,uz;q=0.9",
        )

        assert response.status_code == status.HTTP_200_OK
        content = response.content.decode()
        assert '<html lang="uz">' in content
        assert "Qabul qilish" in content

    def test_task_defaults_include_creator_assignee_and_subscriber(
        self, session_client, create_user, workspace, project, member, observer
    ):
        issue = Issue.objects.create(
            workspace=workspace,
            project=project,
            name="Prepare integration",
            created_by=create_user,
        )
        IssueAssignee.objects.create(
            workspace=workspace,
            project=project,
            issue=issue,
            assignee=member,
        )
        IssueSubscriber.objects.create(
            workspace=workspace,
            project=project,
            issue=issue,
            subscriber=observer,
        )
        response = session_client.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/meeting-defaults/"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["title"].startswith("CAL-")
        assert {item["user_id"] for item in response.data["participants"]} == {
            str(create_user.id),
            str(member.id),
            str(observer.id),
        }

    def test_organizer_is_restored_when_omitted_on_update(
        self, session_client, create_user, workspace, project, member
    ):
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(project, participants=[{"user_id": str(member.id)}]),
            format="json",
        )
        response = session_client.patch(
            meeting_url(workspace, created.data["id"]),
            {"participants": [{"user_id": str(member.id)}]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert MeetingParticipant.objects.filter(
            meeting_id=created.data["id"],
            user=create_user,
            removed_at__isnull=True,
        ).exists()

    @patch("plane.bgtasks.calendar_task.finalize_deleted_meeting.delay")
    def test_delete_hides_meeting_until_provider_cleanup(
        self, finalize_delay, django_capture_on_commit_callbacks, session_client, workspace, project
    ):
        created = session_client.post(meeting_url(workspace), meeting_payload(project), format="json")

        with django_capture_on_commit_callbacks(execute=True):
            response = session_client.delete(meeting_url(workspace, created.data["id"]))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Meeting.objects.filter(id=created.data["id"]).exists()
        hidden = Meeting.all_objects.get(id=created.data["id"])
        assert hidden.status == "CANCELLED"
        finalize_delay.assert_called_once_with(str(hidden.id))

    def test_single_recurring_occurrence_can_be_cancelled(self, session_client, workspace, project):
        start = timezone.now() + timedelta(days=1)
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(
                project,
                starts_at=start.isoformat(),
                ends_at=(start + timedelta(minutes=45)).isoformat(),
                recurrence_rule="RRULE:FREQ=WEEKLY;COUNT=3",
            ),
            format="json",
        )
        cancelled_start = start + timedelta(days=7)
        cancelled = session_client.post(
            f"{meeting_url(workspace, created.data['id'])}occurrence/",
            {"original_starts_at": cancelled_start.isoformat(), "action": "CANCELLED"},
            format="json",
        )
        assert cancelled.status_code == status.HTTP_200_OK

        listed = session_client.get(
            meeting_url(workspace),
            {
                "start": (start - timedelta(days=1)).isoformat(),
                "end": (start + timedelta(days=22)).isoformat(),
                "show_cancelled": "true",
            },
        )
        assert listed.status_code == status.HTTP_200_OK
        assert len(listed.data["occurrences"]) == 2
        assert cancelled_start.astimezone(dt_timezone.utc).strftime("EXDATE:%Y%m%dT%H%M%SZ") in meeting_ics(
            Meeting.objects.get(id=created.data["id"])
        )

    def test_arbitrary_timestamp_cannot_be_added_as_recurrence_exception(self, session_client, workspace, project):
        start = timezone.now() + timedelta(days=1)
        created = session_client.post(
            meeting_url(workspace),
            meeting_payload(
                project,
                starts_at=start.isoformat(),
                ends_at=(start + timedelta(minutes=45)).isoformat(),
                recurrence_rule="RRULE:FREQ=WEEKLY;COUNT=3",
            ),
            format="json",
        )

        response = session_client.post(
            f"{meeting_url(workspace, created.data['id'])}occurrence/",
            {"original_starts_at": (start + timedelta(days=2)).isoformat(), "action": "CANCELLED"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
