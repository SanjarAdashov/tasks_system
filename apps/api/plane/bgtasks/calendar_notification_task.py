# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import html
import logging
from copy import copy
from datetime import timedelta
from email.mime.base import MIMEBase
from email import encoders
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# ruff: noqa: E501 -- email clients require deliberately inlined HTML styles

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from plane.db.models import (
    BirthdayNotificationDelivery,
    Meeting,
    MeetingReminder,
    Notification,
    User,
    WorkspaceMember,
)
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.birthday import is_birthday_on, render_birthday_greeting, user_language
from plane.utils.calendar import expand_recurrence, sign_participant_token
from plane.utils.telegram import (
    application_url,
    enqueue_system_telegram_notification,
    enqueue_telegram_notifications,
)


LOGGER = logging.getLogger("plane.worker")

COPY = {
    "en": {
        "CREATED": "Meeting invitation",
        "UPDATED": "Meeting updated",
        "CANCELLED": "Meeting cancelled",
        "REMINDER": "Meeting reminder",
        "title": "Meeting",
        "when": "When",
        "where": "Where",
        "organizer": "Organizer",
        "open": "Open in GTS Tasks System",
        "respond": "Respond to invitation",
    },
    "ru": {
        "CREATED": "Приглашение на встречу",
        "UPDATED": "Встреча изменена",
        "CANCELLED": "Встреча отменена",
        "REMINDER": "Напоминание о встрече",
        "title": "Встреча",
        "when": "Когда",
        "where": "Где",
        "organizer": "Организатор",
        "open": "Открыть в GTS Tasks System",
        "respond": "Ответить на приглашение",
    },
    "uz": {
        "CREATED": "Uchrashuvga taklif",
        "UPDATED": "Uchrashuv o‘zgartirildi",
        "CANCELLED": "Uchrashuv bekor qilindi",
        "REMINDER": "Uchrashuv eslatmasi",
        "title": "Uchrashuv",
        "when": "Vaqti",
        "where": "Joy",
        "organizer": "Tashkilotchi",
        "open": "GTS Tasks System’da ochish",
        "respond": "Taklifga javob berish",
    },
}

RESPONSE_COPY = {
    "en": {
        "subject": "Invitation response",
        "ACCEPTED": "accepted",
        "TENTATIVE": "answered maybe",
        "DECLINED": "declined",
    },
    "ru": {
        "subject": "Ответ на приглашение",
        "ACCEPTED": "принял(а) приглашение",
        "TENTATIVE": "ответил(а) «Возможно»",
        "DECLINED": "отклонил(а) приглашение",
    },
    "uz": {
        "subject": "Taklifga javob",
        "ACCEPTED": "taklifni qabul qildi",
        "TENTATIVE": "«Balki» deb javob berdi",
        "DECLINED": "taklifni rad etdi",
    },
}

BIRTHDAY_ADVANCE_COPY = {
    "en": {
        "subject": "Birthday tomorrow: {name}",
        "body": "Tomorrow is {name}’s birthday.",
    },
    "ru": {
        "subject": "Завтра день рождения: {name}",
        "body": "Завтра день рождения у {name}.",
    },
    "uz": {
        "subject": "Ertaga tug‘ilgan kun: {name}",
        "body": "Ertaga {name}ning tug‘ilgan kuni.",
    },
}


def _language(user):
    value = getattr(user, "language", "") or getattr(user, "locale", "") or "en"
    value = str(value).lower()
    return "uz" if value.startswith("uz") else "ru" if value.startswith("ru") else "en"


def _notification_enabled(user, field):
    if not user:
        return True
    try:
        return bool(getattr(user.calendar_preference, field))
    except Exception:
        return True


def _meeting_url(meeting):
    origin = (getattr(settings, "WEB_URL", "") or getattr(settings, "APP_BASE_URL", "") or "").rstrip("/")
    return (
        f"{origin}/{meeting.workspace.slug}/calendar?meeting={meeting.id}"
        if meeting.workspace_id
        else f"{origin}/calendar?meeting={meeting.id}"
    )


def _participant_response_url(participant):
    origin = (getattr(settings, "WEB_URL", "") or getattr(settings, "APP_BASE_URL", "") or "").rstrip("/")
    token = sign_participant_token(participant.id)
    return f"{origin}/api/calendar/public/respond/{token}/?format=html"


def _format_when(meeting, user):
    try:
        zone = ZoneInfo(getattr(user, "user_timezone", "") or meeting.timezone or "UTC")
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    starts = meeting.starts_at.astimezone(zone)
    ends = meeting.ends_at.astimezone(zone)
    if meeting.all_day:
        return starts.strftime("%d.%m.%Y")
    return f"{starts:%d.%m.%Y %H:%M}–{ends:%H:%M} ({zone.key})"


def _ics_bytes(meeting, method):
    # Local import avoids an import cycle between the API view and worker modules.
    from plane.app.views.calendar import meeting_ics

    return meeting_ics(meeting, method="CANCEL" if method == "CANCELLED" else "REQUEST").encode("utf-8")


def _render_message(meeting, participant, event):
    user = participant.user
    language = _language(user)
    copy = COPY[language]
    when = _format_when(meeting, user)
    location = meeting.meeting_url or meeting.location or "—"
    heading = copy.get(event, copy["UPDATED"])
    meeting_url = _meeting_url(meeting)
    response_url = _participant_response_url(participant)
    body = f"""<!doctype html><html lang="{language}"><body style="margin:0;background:#f4f5f7;color:#172b4d;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dfe1e6;border-radius:12px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #ebecf0"><strong style="font-size:18px">GTS Tasks System</strong></td></tr>
<tr><td style="padding:28px"><div style="font-size:13px;color:#6b778c">{html.escape(heading)}</div>
<h1 style="margin:8px 0 24px;font-size:24px">{html.escape(meeting.title)}</h1>
<p><strong>{copy["when"]}:</strong> {html.escape(when)}</p>
<p><strong>{copy["where"]}:</strong> {html.escape(location)}</p>
<p><strong>{copy["organizer"]}:</strong> {html.escape(meeting.organizer.full_name or meeting.organizer.email)}</p>
{f'<p style="white-space:pre-wrap">{html.escape(meeting.description)}</p>' if meeting.description else ""}
<p style="margin-top:28px"><a href="{html.escape(meeting_url)}" style="background:#0c66e4;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px">{copy["open"]}</a></p>
<p style="margin-top:22px"><a href="{html.escape(response_url)}">{copy["respond"]}</a></p>
</td></tr></table></td></tr></table></body></html>"""
    text = "\n".join(
        [
            f"GTS Tasks System — {heading}",
            meeting.title,
            f"{copy['when']}: {when}",
            f"{copy['where']}: {location}",
            f"{copy['organizer']}: {meeting.organizer.full_name or meeting.organizer.email}",
            meeting.description,
            meeting_url,
            response_url,
        ]
    )
    return f"{heading}: {meeting.title}", text, body


def _smtp_connection():
    host, user, password, port, use_tls, use_ssl, sender = get_email_configuration()
    if not host:
        return None, sender
    return (
        get_connection(
            host=host,
            port=int(port),
            username=user,
            password=password,
            use_tls=use_tls == "1",
            use_ssl=use_ssl == "1",
        ),
        sender,
    )


def _birthday_email(subject, message, recipient, language):
    connection, sender = _smtp_connection()
    if not connection or not recipient.email:
        return False
    body = f"""<!doctype html><html lang="{language}"><body style="margin:0;background:#f4f5f7;color:#172b4d;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dfe1e6;border-radius:16px"><tr><td style="padding:26px 30px;border-bottom:1px solid #ebecf0"><strong style="font-size:18px">GTS Tasks System</strong></td></tr><tr><td style="padding:36px 30px"><h1 style="margin:0 0 16px;font-size:28px">{html.escape(subject)}</h1><p style="margin:0;font-size:16px;line-height:1.6">{html.escape(message)}</p></td></tr></table></td></tr></table></body></html>"""
    try:
        email_message = EmailMultiAlternatives(subject, message, sender, [recipient.email], connection=connection)
        email_message.attach_alternative(body, "text/html")
        email_message.send(fail_silently=False)
        return True
    except Exception:
        LOGGER.exception("Failed to send birthday email", extra={"user_id": str(recipient.id)})
        return False


def _claim_birthday_delivery(recipient, birthday_user, year, delivery_type):
    return BirthdayNotificationDelivery.objects.filter(
        recipient=recipient,
        birthday_user=birthday_user,
        occurrence_year=year,
        delivery_type=delivery_type,
    ).exists()


def _record_birthday_delivery(recipient, birthday_user, year, delivery_type):
    BirthdayNotificationDelivery.objects.get_or_create(
        recipient=recipient,
        birthday_user=birthday_user,
        occurrence_year=year,
        delivery_type=delivery_type,
    )


def _deliver_self_birthday_greeting(user, local_date):
    greeting = render_birthday_greeting(user)
    year = local_date.year
    if not _claim_birthday_delivery(user, user, year, BirthdayNotificationDelivery.DeliveryType.SELF_EMAIL):
        if _birthday_email(greeting["title"], greeting["message"], user, greeting["language"]):
            _record_birthday_delivery(user, user, year, BirthdayNotificationDelivery.DeliveryType.SELF_EMAIL)
    if not _claim_birthday_delivery(user, user, year, BirthdayNotificationDelivery.DeliveryType.SELF_TELEGRAM):
        delivery = enqueue_system_telegram_notification(
            user=user,
            category="account_activity",
            event="birthday_greeting",
            context={
                "localized": {greeting["language"]: greeting["message"], "en": greeting["message"]},
                "url": application_url(""),
                "button_key": "open_home",
            },
            respect_preferences=False,
            idempotency_key=f"birthday:self:{user.id}:{year}",
        )
        if delivery:
            _record_birthday_delivery(user, user, year, BirthdayNotificationDelivery.DeliveryType.SELF_TELEGRAM)


def _deliver_advance_birthday_notifications(birthday_user, tomorrow):
    memberships = list(
        WorkspaceMember.objects.filter(
            member=birthday_user,
            is_active=True,
            workspace__deleted_at__isnull=True,
        ).select_related("workspace")
    )
    workspace_ids = [membership.workspace_id for membership in memberships]
    if not workspace_ids:
        return
    workspace_by_recipient = {}
    recipients = (
        User.objects.filter(
            workspace_member__workspace_id__in=workspace_ids,
            workspace_member__is_active=True,
            is_active=True,
            blocked_at__isnull=True,
            is_bot=False,
        )
        .exclude(pk=birthday_user.id)
        .select_related("profile")
        .distinct()
    )
    for membership in WorkspaceMember.objects.filter(
        workspace_id__in=workspace_ids,
        is_active=True,
        member_id__in=recipients.values("id"),
    ).select_related("workspace"):
        workspace_by_recipient.setdefault(membership.member_id, membership.workspace)
    birthday_name = birthday_user.full_name or birthday_user.email
    year = tomorrow.year
    for recipient in recipients:
        language = user_language(recipient)
        copy = BIRTHDAY_ADVANCE_COPY[language]
        subject = copy["subject"].format(name=birthday_name)
        message = copy["body"].format(name=birthday_name)
        workspace = workspace_by_recipient.get(recipient.id)
        workspace_id = workspace.id if workspace else None
        if not _claim_birthday_delivery(
            recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_IN_APP
        ):
            Notification.objects.create(
                workspace_id=workspace_id,
                data={"birthday": {"user_id": str(birthday_user.id), "date": tomorrow.isoformat()}},
                entity_identifier=birthday_user.id,
                entity_name="birthday",
                title=subject,
                message={"event": "BIRTHDAY_TOMORROW"},
                message_stripped=message,
                sender="in_app:birthday:advance",
                triggered_by=birthday_user,
                receiver=recipient,
            )
            _record_birthday_delivery(
                recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_IN_APP
            )
        if not _claim_birthday_delivery(
            recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_EMAIL
        ) and _birthday_email(subject, message, recipient, language):
            _record_birthday_delivery(
                recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_EMAIL
            )
        if not _claim_birthday_delivery(
            recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_TELEGRAM
        ):
            delivery = enqueue_system_telegram_notification(
                user=recipient,
                category="account_activity",
                event="birthday_tomorrow",
                context={
                    "localized": {
                        language: message,
                        "en": BIRTHDAY_ADVANCE_COPY["en"]["body"].format(name=birthday_name),
                    },
                    "workspace_id": str(workspace_id) if workspace_id else None,
                    "url": application_url(f"{workspace.slug}/calendar/") if workspace else application_url(""),
                    "button_key": "open_home",
                },
                actor=birthday_user,
                idempotency_key=f"birthday:advance:{recipient.id}:{birthday_user.id}:{year}",
            )
            if delivery:
                _record_birthday_delivery(
                    recipient, birthday_user, year, BirthdayNotificationDelivery.DeliveryType.ADVANCE_TELEGRAM
                )


@shared_task
def process_birthday_notifications():
    now = timezone.now()
    processed = 0
    users = User.objects.filter(
        date_of_birth__isnull=False,
        is_active=True,
        blocked_at__isnull=True,
        is_bot=False,
    ).select_related("profile")
    for user in users.iterator(chunk_size=250):
        try:
            zone = ZoneInfo(user.user_timezone or "UTC")
        except (ZoneInfoNotFoundError, ValueError):
            zone = ZoneInfo("UTC")
        local_now = now.astimezone(zone)
        if local_now.hour != 9 or local_now.minute >= 5:
            continue
        today = local_now.date()
        if is_birthday_on(user, today):
            _deliver_self_birthday_greeting(user, today)
            processed += 1
        tomorrow = today + timedelta(days=1)
        if is_birthday_on(user, tomorrow):
            _deliver_advance_birthday_notifications(user, tomorrow)
            processed += 1
    return {"processed": processed}


@shared_task
def send_meeting_notifications(
    meeting_id,
    event="UPDATED",
    participant_ids=None,
    occurrence_starts_at=None,
    occurrence_ends_at=None,
    include_deleted=False,
    changes=None,
    actor_id=None,
):
    manager = Meeting.all_objects if include_deleted else Meeting.objects
    meeting = (
        manager.select_related("workspace", "project", "organizer")
        .prefetch_related("participants__user")
        .filter(pk=meeting_id)
        .first()
    )
    if not meeting:
        return {"skipped": True}
    actor = meeting.organizer
    if actor_id:
        actor = User.objects.filter(pk=actor_id).first() or actor
    rendered_meeting = meeting
    occurrence_start = parse_datetime(occurrence_starts_at or "")
    occurrence_end = parse_datetime(occurrence_ends_at or "")
    if occurrence_start and occurrence_end:
        rendered_meeting = copy(meeting)
        rendered_meeting.starts_at = occurrence_start
        rendered_meeting.ends_at = occurrence_end
    participants = meeting.participants.filter(removed_at__isnull=True).select_related("user__calendar_preference")
    if participant_ids:
        participants = participants.filter(id__in=participant_ids)
    connection, sender = _smtp_connection()
    sent = 0
    if connection:
        for participant in participants:
            if (
                not participant.notify_by_email
                or not participant.email
                or not _notification_enabled(participant.user, "email_notifications_enabled")
            ):
                continue
            try:
                subject, text, html_body = _render_message(rendered_meeting, participant, event)
                message = EmailMultiAlternatives(subject, text, sender, [participant.email], connection=connection)
                message.attach_alternative(html_body, "text/html")
                attachment = MIMEBase("text", "calendar", method="CANCEL" if event == "CANCELLED" else "REQUEST")
                attachment.set_payload(_ics_bytes(rendered_meeting, event))
                encoders.encode_base64(attachment)
                attachment.add_header("Content-Disposition", "attachment", filename="meeting.ics")
                message.attach(attachment)
                message.send(fail_silently=False)
                sent += 1
            except Exception:
                LOGGER.exception("Failed to send calendar email", extra={"meeting_id": str(meeting.id)})

    if meeting.workspace_id:
        internal = [
            item
            for item in participants
            if item.user_id != meeting.organizer_id
            and item.user_id is not None
            and _notification_enabled(item.user, "in_app_notifications_enabled")
        ]
        rows = [
            Notification(
                workspace=meeting.workspace,
                project=meeting.project,
                data={
                    "meeting": {
                        "id": str(meeting.id),
                        "title": meeting.title,
                        "starts_at": rendered_meeting.starts_at.isoformat(),
                        "ends_at": rendered_meeting.ends_at.isoformat(),
                        "event": event,
                        "changes": changes or {},
                    }
                },
                entity_identifier=meeting.id,
                entity_name="meeting",
                title=meeting.title,
                message={"event": event},
                message_stripped=f"{COPY[_language(item.user)].get(event, event)}: {meeting.title}",
                sender="in_app:calendar:meeting",
                triggered_by=actor,
                receiver=item.user,
            )
            for item in internal
        ]
        notifications = Notification.objects.bulk_create(rows, ignore_conflicts=True)
        enqueue_telegram_notifications(notifications)
    return {"sent": sent, "in_app": len(notifications) if meeting.workspace_id else 0}


@shared_task
def send_meeting_response_notification(participant_id):
    from plane.db.models import MeetingParticipant

    participant = (
        MeetingParticipant.objects.select_related("meeting", "meeting__organizer", "meeting__workspace", "user")
        .filter(pk=participant_id, removed_at__isnull=True)
        .first()
    )
    if not participant or participant.user_id == participant.meeting.organizer_id:
        return {"skipped": True}
    meeting = participant.meeting
    organizer = meeting.organizer
    language = _language(organizer)
    copy = RESPONSE_COPY[language]
    response_label = copy.get(participant.response_status, participant.response_status)
    participant_name = participant.name or participant.email
    subject = f"{copy['subject']}: {meeting.title}"
    text = f"{participant_name} {response_label}: {meeting.title}\n{_meeting_url(meeting)}"
    body = f"""<!doctype html><html lang="{language}"><body style="font-family:Arial,sans-serif;background:#f4f5f7;padding:24px;color:#172b4d"><main style="max-width:600px;margin:auto;background:#fff;border:1px solid #dfe1e6;border-radius:12px;padding:28px"><strong>GTS Tasks System</strong><h1 style="font-size:22px">{html.escape(meeting.title)}</h1><p><strong>{html.escape(participant_name)}</strong> {html.escape(response_label)}.</p><p><a href="{html.escape(_meeting_url(meeting))}">{COPY[language]["open"]}</a></p></main></body></html>"""
    connection, sender = _smtp_connection()
    sent = 0
    if connection and organizer.email and _notification_enabled(organizer, "email_notifications_enabled"):
        try:
            message = EmailMultiAlternatives(subject, text, sender, [organizer.email], connection=connection)
            message.attach_alternative(body, "text/html")
            sent = message.send(fail_silently=False)
        except Exception:
            LOGGER.exception("Failed to send meeting RSVP email", extra={"meeting_id": str(meeting.id)})
    if meeting.workspace_id and _notification_enabled(organizer, "in_app_notifications_enabled"):
        notification = Notification.objects.create(
            workspace=meeting.workspace,
            project=meeting.project,
            data={
                "meeting": {
                    "id": str(meeting.id),
                    "title": meeting.title,
                    "event": "RSVP_CHANGED",
                    "participant_name": participant_name,
                    "response_status": participant.response_status,
                }
            },
            entity_identifier=meeting.id,
            entity_name="meeting",
            title=meeting.title,
            message={"event": "RSVP_CHANGED", "response_status": participant.response_status},
            message_stripped=f"{participant_name} {response_label}: {meeting.title}",
            sender="in_app:calendar:rsvp",
            triggered_by=participant.user,
            receiver=organizer,
        )
        enqueue_telegram_notifications([notification])
    return {"sent": sent}


@shared_task
def process_due_meeting_reminders():
    now = timezone.now()
    reminder_ids = list(
        MeetingReminder.objects.filter(sent_at__isnull=True, scheduled_for__lte=now, meeting__status="PLANNED")
        .order_by("scheduled_for")
        .values_list("id", flat=True)[:500]
    )
    for reminder_id in reminder_ids:
        with transaction.atomic():
            reminder = (
                MeetingReminder.objects.select_for_update()
                .select_related("meeting")
                .prefetch_related("meeting__recurrence_exceptions")
                .filter(pk=reminder_id, sent_at__isnull=True)
                .first()
            )
            if not reminder:
                continue
            occurrence_start = reminder.scheduled_for + timedelta(minutes=reminder.minutes_before)
            occurrence_end = occurrence_start + (reminder.meeting.ends_at - reminder.meeting.starts_at)
            current_cancelled = reminder.meeting.recurrence_exceptions.filter(
                original_starts_at=occurrence_start,
                action="CANCELLED",
                deleted_at__isnull=True,
            ).exists()
            next_occurrence = None
            if reminder.meeting.recurrence_rule:
                candidates = expand_recurrence(
                    reminder.meeting,
                    now + timedelta(minutes=reminder.minutes_before, seconds=1),
                    now + timedelta(days=730),
                    limit=1,
                )
                next_occurrence = candidates[0] if candidates else None
            if next_occurrence:
                reminder.scheduled_for = next_occurrence["starts_at"] - timedelta(minutes=reminder.minutes_before)
                reminder.sent_at = None
                reminder.save(update_fields=["scheduled_for", "sent_at", "updated_at"])
            else:
                reminder.sent_at = now
                reminder.save(update_fields=["sent_at", "updated_at"])
        if not current_cancelled:
            participant_ids = [str(reminder.participant_id)] if reminder.participant_id else None
            send_meeting_notifications.delay(
                str(reminder.meeting_id),
                "REMINDER",
                participant_ids,
                occurrence_start.isoformat(),
                occurrence_end.isoformat(),
            )
    return {"processed": len(reminder_ids)}
