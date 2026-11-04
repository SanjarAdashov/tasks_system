from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import Mock
from uuid import uuid4

import pytest
from django.core import mail
from django.core.mail import get_connection

from plane.bgtasks.calendar_notification_task import process_due_meeting_reminders, send_meeting_notifications
from plane.db.models import Meeting, MeetingParticipant, MeetingRecurrenceException, MeetingReminder, Notification, User


TASK_MODULE = "plane.bgtasks.calendar_notification_task"
START = datetime(2026, 11, 6, 13, 30, tzinfo=dt_timezone.utc)


@pytest.fixture
def make_reminder(create_user, workspace):
    def create(*, recurrence="RRULE:FREQ=WEEKLY;COUNT=6", minutes_before=15):
        meeting = Meeting.objects.create(
            workspace=workspace,
            organizer=create_user,
            title="Weekly review",
            starts_at=START,
            ends_at=START + timedelta(minutes=30),
            recurrence_rule=recurrence,
        )
        reminder = MeetingReminder.objects.create(
            meeting=meeting,
            minutes_before=minutes_before,
            scheduled_for=START - timedelta(minutes=minutes_before),
        )
        return meeting, reminder

    return create


@pytest.mark.contract
@pytest.mark.django_db
class TestMeetingReminders:
    def test_weekly_reminder_sends_one_email_and_telegram_notification_per_occurrence(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks
    ):
        meeting, reminder = make_reminder()
        recipient = User.objects.create(
            email="reminder-recipient@example.test", username="reminder-recipient", first_name="Recipient"
        )
        MeetingParticipant.objects.create(
            meeting=meeting,
            user=recipient,
            email=recipient.email,
            response_token_hash=uuid4().hex,
        )
        telegram_notifications = []
        monkeypatch.setattr(
            f"{TASK_MODULE}._smtp_connection",
            lambda: (get_connection("django.core.mail.backends.locmem.EmailBackend"), "tasks@example.test"),
        )
        monkeypatch.setattr(
            f"{TASK_MODULE}.enqueue_telegram_notifications",
            lambda notifications: telegram_notifications.extend(notifications),
        )
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send_meeting_notifications)
        mail.outbox.clear()
        due = reminder.scheduled_for

        def run_at(now):
            monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: now)
            with django_capture_on_commit_callbacks(execute=True):
                process_due_meeting_reminders()

        run_at(due - timedelta(seconds=1))
        assert len(mail.outbox) == len(telegram_notifications) == 0
        for minute in range(46):
            run_at(due + timedelta(minutes=minute))

        assert len(mail.outbox) == len(telegram_notifications) == 1
        assert telegram_notifications[0].data["meeting"]["starts_at"] == START.isoformat()
        reminder.refresh_from_db()
        assert reminder.scheduled_for == due + timedelta(weeks=1)
        assert reminder.sent_at is None

        run_at(due + timedelta(weeks=1) - timedelta(seconds=1))
        assert len(mail.outbox) == len(telegram_notifications) == 1
        run_at(due + timedelta(weeks=1))
        run_at(due + timedelta(weeks=1, minutes=1))

        assert len(mail.outbox) == len(telegram_notifications) == 2
        assert telegram_notifications[1].data["meeting"]["starts_at"] == (START + timedelta(weeks=1)).isoformat()
        assert Notification.objects.filter(entity_name="meeting", message__event="REMINDER").count() == 2

    @pytest.mark.parametrize("change", ["rescheduled", "cancelled", "deleted"])
    def test_stale_due_snapshot_does_not_send_a_future_or_cancelled_meeting(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks, change
    ):
        meeting, reminder = make_reminder()
        due = reminder.scheduled_for
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: due)
        send = Mock()
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send)
        manager = MeetingReminder.objects
        select_for_update = manager.select_for_update

        def change_after_due_snapshot(*args, **kwargs):
            if change == "rescheduled":
                manager.filter(pk=reminder.pk).update(scheduled_for=due + timedelta(weeks=1))
            elif change == "cancelled":
                Meeting.objects.filter(pk=meeting.pk).update(status="CANCELLED")
            else:
                Meeting.objects.filter(pk=meeting.pk).update(deleted_at=due)
            return select_for_update(*args, **kwargs)

        monkeypatch.setattr(manager, "select_for_update", change_after_due_snapshot)
        with django_capture_on_commit_callbacks(execute=True):
            process_due_meeting_reminders()

        send.assert_not_called()
        reminder.refresh_from_db()
        assert reminder.scheduled_for == (due + timedelta(weeks=1) if change == "rescheduled" else due)
        assert reminder.sent_at is None

    @pytest.mark.parametrize("cancelled_count", [1, 3])
    def test_cancelled_future_occurrences_are_skipped_without_ending_the_series(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks, cancelled_count
    ):
        meeting, reminder = make_reminder()
        for week in range(1, cancelled_count + 1):
            MeetingRecurrenceException.objects.create(
                meeting=meeting, original_starts_at=START + timedelta(weeks=week), action="CANCELLED"
            )
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: reminder.scheduled_for)
        send = Mock()
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send)
        with django_capture_on_commit_callbacks(execute=True):
            process_due_meeting_reminders()

        send.assert_called_once()
        reminder.refresh_from_db()
        assert reminder.scheduled_for == START + timedelta(weeks=cancelled_count + 1, minutes=-15)
        assert reminder.sent_at is None

    def test_cancelled_due_occurrence_is_not_sent_and_next_week_remains_scheduled(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks
    ):
        meeting, reminder = make_reminder()
        MeetingRecurrenceException.objects.create(meeting=meeting, original_starts_at=START, action="CANCELLED")
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: reminder.scheduled_for)
        send = Mock()
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send)
        with django_capture_on_commit_callbacks(execute=True):
            process_due_meeting_reminders()

        send.assert_not_called()
        reminder.refresh_from_db()
        assert reminder.scheduled_for == START + timedelta(weeks=1, minutes=-15)
        assert reminder.sent_at is None

    @pytest.mark.parametrize("recurrence", ["", "RRULE:FREQ=WEEKLY;COUNT=1", "invalid-rule"])
    def test_single_or_last_occurrence_is_sent_once(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks, recurrence
    ):
        _, reminder = make_reminder(recurrence=recurrence)
        due = reminder.scheduled_for
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: due)
        send = Mock()
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send)
        for _ in range(2):
            with django_capture_on_commit_callbacks(execute=True):
                process_due_meeting_reminders()

        send.assert_called_once()
        reminder.refresh_from_db()
        assert reminder.sent_at == due

    def test_late_processing_advances_directly_to_a_future_reminder(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks
    ):
        _, reminder = make_reminder()
        now = reminder.scheduled_for + timedelta(weeks=2, minutes=1)
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: now)
        send = Mock()
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", send)
        for _ in range(2):
            with django_capture_on_commit_callbacks(execute=True):
                process_due_meeting_reminders()

        send.assert_called_once()
        reminder.refresh_from_db()
        assert reminder.scheduled_for == START + timedelta(weeks=3, minutes=-15)

    def test_next_occurrence_beyond_two_years_is_kept(
        self, make_reminder, monkeypatch, django_capture_on_commit_callbacks
    ):
        _, reminder = make_reminder(recurrence="RRULE:FREQ=YEARLY;INTERVAL=3;COUNT=2")
        monkeypatch.setattr(f"{TASK_MODULE}.timezone.now", lambda: reminder.scheduled_for)
        monkeypatch.setattr(f"{TASK_MODULE}.send_meeting_notifications.delay", Mock())
        with django_capture_on_commit_callbacks(execute=True):
            process_due_meeting_reminders()

        reminder.refresh_from_db()
        assert reminder.scheduled_for == START.replace(year=2029) - timedelta(minutes=15)
        assert reminder.sent_at is None
