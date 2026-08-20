# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import html
import re
from datetime import datetime, time, timedelta
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.utils import timezone
from django.utils.html import strip_tags

from plane.db.models import (
    Issue,
    IssueVisibility,
    ProjectMember,
    State,
    TelegramDelivery,
    TelegramNotificationPreference,
    TelegramUserConnection,
    User,
)
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import decrypt_data, encrypt_data
from plane.utils.issue_access import can_view_issue


TELEGRAM_SECRET_CONFIGURATION_KEYS = {
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_PROXY_URL",
    "TELEGRAM_API_ENDPOINT",
}
TELEGRAM_CONFIGURATION_KEYS = TELEGRAM_SECRET_CONFIGURATION_KEYS | {
    "TELEGRAM_BOT_ID",
    "TELEGRAM_BOT_USERNAME",
    "ENABLE_TELEGRAM",
}
TELEGRAM_PROXY_SCHEMES = {"http", "https", "socks5", "socks5h"}
TELEGRAM_STANDARD_API_ENDPOINT = "https://api.telegram.org"

PREFERENCE_FIELDS = {
    "task_assignment",
    "mention",
    "comment",
    "state_change",
    "issue_completed",
    "priority",
    "due_date",
    "property_change",
    "role_change",
    "account_activity",
    "project_announcement",
}

TELEGRAM_COMMENT_CATEGORIES = {"mention", "comment"}
TELEGRAM_COMMENT_LIMIT = 1200
TELEGRAM_BLOCK_TAG_RE = re.compile(
    r"<\s*(?:br\s*/?|/(?:p|div|li|blockquote|h[1-6]|pre))\s*>",
    re.IGNORECASE,
)
TELEGRAM_HIDDEN_HTML_RE = re.compile(
    r"<(script|style)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
TELEGRAM_EMPTY_VALUES = {"", "none", "null", "undefined", "nil"}
TELEGRAM_ATTACHMENT_FIELDS = {"attachment", "attachments"}
TELEGRAM_STORED_FILENAME_RE = re.compile(r"^[0-9a-f]{32}-(.+)$", re.IGNORECASE)


class TelegramAPIError(Exception):
    def __init__(self, message, *, error_code=None, retry_after=None):
        super().__init__(message)
        self.error_code = error_code
        self.retry_after = retry_after


def _config_value(key, default=""):
    configuration = InstanceConfiguration.objects.filter(key=key).first()
    if not configuration:
        return default
    return decrypt_data(configuration.value) if configuration.is_encrypted else (configuration.value or default)


def telegram_configuration():
    return {
        "enabled": _config_value("ENABLE_TELEGRAM", "0") == "1",
        "token": _config_value("TELEGRAM_BOT_TOKEN"),
        "webhook_secret": _config_value("TELEGRAM_WEBHOOK_SECRET"),
        "bot_id": _config_value("TELEGRAM_BOT_ID"),
        "bot_username": _config_value("TELEGRAM_BOT_USERNAME"),
        "proxy_url": _config_value("TELEGRAM_PROXY_URL"),
        "api_endpoint": _config_value("TELEGRAM_API_ENDPOINT"),
    }


def validate_telegram_proxy_url(proxy_url):
    value = (proxy_url or "").strip()
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise TelegramAPIError("Proxy URL is invalid") from exc
    if parsed.scheme.lower() not in TELEGRAM_PROXY_SCHEMES:
        raise TelegramAPIError("Proxy URL must use http, https, socks5, or socks5h")
    if not parsed.hostname or port is None:
        raise TelegramAPIError("Proxy URL must include a host and port")
    if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise TelegramAPIError("Proxy URL cannot include a path, query, or fragment")
    return value


def validate_telegram_api_endpoint(api_endpoint):
    value = (api_endpoint or "").strip().rstrip("/")
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise TelegramAPIError("Telegram API endpoint is invalid") from exc
    if parsed.scheme.lower() != "https":
        raise TelegramAPIError("Telegram API endpoint must use HTTPS")
    if not parsed.hostname:
        raise TelegramAPIError("Telegram API endpoint must include a host")
    if parsed.query or parsed.fragment:
        raise TelegramAPIError("Telegram API endpoint cannot include a query or fragment")
    if port is not None and not 1 <= port <= 65535:
        raise TelegramAPIError("Telegram API endpoint port is invalid")
    return value


def save_telegram_configuration(
    *,
    token,
    webhook_secret,
    bot_id,
    bot_username,
    enabled=True,
    proxy_url="",
    api_endpoint="",
):
    values = {
        "TELEGRAM_BOT_TOKEN": (token, True),
        "TELEGRAM_WEBHOOK_SECRET": (webhook_secret, True),
        "TELEGRAM_BOT_ID": (str(bot_id), False),
        "TELEGRAM_BOT_USERNAME": (bot_username, False),
        "ENABLE_TELEGRAM": ("1" if enabled else "0", False),
    }
    proxy_url = validate_telegram_proxy_url(proxy_url)
    if proxy_url:
        values["TELEGRAM_PROXY_URL"] = (proxy_url, True)
    else:
        InstanceConfiguration.objects.filter(key="TELEGRAM_PROXY_URL").delete()
    api_endpoint = validate_telegram_api_endpoint(api_endpoint)
    if api_endpoint:
        values["TELEGRAM_API_ENDPOINT"] = (api_endpoint, True)
    else:
        InstanceConfiguration.objects.filter(key="TELEGRAM_API_ENDPOINT").delete()
    for key, (value, encrypted) in values.items():
        stored_value = encrypt_data(value) if encrypted else value
        InstanceConfiguration.objects.update_or_create(
            key=key,
            defaults={"value": stored_value, "category": "TELEGRAM", "is_encrypted": encrypted},
        )


def clear_telegram_configuration():
    InstanceConfiguration.objects.filter(key__in=TELEGRAM_CONFIGURATION_KEYS).delete()


def telegram_api_call(method, payload=None, *, token=None, timeout=15, proxy_url=None, api_endpoint=None):
    configuration = telegram_configuration()
    bot_token = token or configuration["token"]
    if not bot_token:
        raise TelegramAPIError("Telegram bot is not configured")
    effective_proxy_url = configuration["proxy_url"] if proxy_url is None else validate_telegram_proxy_url(proxy_url)
    effective_api_endpoint = (
        configuration["api_endpoint"] if api_endpoint is None else validate_telegram_api_endpoint(api_endpoint)
    )
    api_base_url = effective_api_endpoint or TELEGRAM_STANDARD_API_ENDPOINT
    proxies = {"http": effective_proxy_url, "https": effective_proxy_url} if effective_proxy_url else None
    try:
        response = requests.post(
            f"{api_base_url}/bot{bot_token}/{method}",
            json=payload or {},
            timeout=timeout,
            proxies=proxies,
        )
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        if effective_proxy_url:
            message = "Telegram proxy is unavailable"
        elif effective_api_endpoint:
            message = "Telegram API endpoint is unavailable"
        else:
            message = "Telegram API is unavailable"
        raise TelegramAPIError(message) from exc
    if not response.ok or not data.get("ok"):
        parameters = data.get("parameters") or {}
        raise TelegramAPIError(
            data.get("description") or "Telegram API request failed",
            error_code=data.get("error_code") or response.status_code,
            retry_after=parameters.get("retry_after"),
        )
    return data.get("result")


def application_url(path=""):
    base = (getattr(settings, "APP_BASE_URL", None) or settings.WEB_URL or "").rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def api_url(path=""):
    base = (settings.WEB_URL or getattr(settings, "APP_BASE_URL", None) or "").rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def user_name(user):
    name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return name or user.email


def preference_for(user):
    preference, _ = TelegramNotificationPreference.objects.get_or_create(user=user)
    return preference


def quiet_hours_available_at(user, preference, now=None):
    now = now or timezone.now()
    if not preference.quiet_hours_enabled:
        return now
    try:
        local_now = now.astimezone(ZoneInfo(user.user_timezone or "UTC"))
    except Exception:
        local_now = now.astimezone(ZoneInfo("UTC"))
    schedule = preference.quiet_hours or {}
    for day_offset in (0, -1):
        start_date = local_now.date() + timedelta(days=day_offset)
        entry = schedule.get(str(start_date.isoweekday())) or {}
        if not entry.get("enabled"):
            continue
        try:
            start_value = time.fromisoformat(entry.get("start", "22:00"))
            end_value = time.fromisoformat(entry.get("end", "08:00"))
        except ValueError:
            continue
        start_at = datetime.combine(start_date, start_value, tzinfo=local_now.tzinfo)
        end_date = start_date + timedelta(days=1 if end_value <= start_value else 0)
        end_at = datetime.combine(end_date, end_value, tzinfo=local_now.tzinfo)
        if start_at <= local_now < end_at:
            return end_at.astimezone(ZoneInfo("UTC"))
    return now


def notification_category(notification):
    if notification.entity_name == "project_announcement":
        return "project_announcement"
    if notification.entity_name == "meeting":
        return "account_activity"
    activity = (notification.data or {}).get("issue_activity") or {}
    field = activity.get("field") or ""
    if field in {"assignees", "assignee"}:
        return "task_assignment"
    if field == "mention" or "mentioned" in (notification.sender or ""):
        return "mention"
    if field == "comment":
        return "comment"
    if field == "state":
        new_identifier = activity.get("new_identifier")
        if new_identifier and State.objects.filter(pk=new_identifier, group="completed").exists():
            return "issue_completed"
        return "state_change"
    if field == "priority":
        return "priority"
    if field in {"target_date", "due_date", "start_date"}:
        return "due_date"
    return "property_change"


def telegram_plain_text(value, limit=TELEGRAM_COMMENT_LIMIT):
    if value is None:
        return ""
    source = TELEGRAM_HIDDEN_HTML_RE.sub("", str(value))
    source = TELEGRAM_BLOCK_TAG_RE.sub("\n", source)
    text = html.unescape(strip_tags(source)).replace("\u200b", "")
    lines = [" ".join(line.split()) for line in text.splitlines()]
    text = "\n".join(line for line in lines if line).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _resolved_activity_value(activity, prefix):
    field = activity.get("field") or ""
    value = activity.get(f"{prefix}_value")
    identifier = activity.get(f"{prefix}_identifier")
    if not identifier:
        return value
    if field == "state":
        return State.objects.filter(pk=identifier).values_list("name", flat=True).first() or value
    if field in {"assignee", "assignees"}:
        user = User.objects.filter(pk=identifier).only("first_name", "last_name", "email").first()
        return user_name(user) if user else value
    return value


def _attachment_filename(value):
    value = telegram_plain_text(value, limit=500)
    if not value or value.lower() in TELEGRAM_EMPTY_VALUES:
        return ""
    path = urlsplit(value).path if "://" in value else value
    filename = unquote(PurePosixPath(path).name)
    stored_match = TELEGRAM_STORED_FILENAME_RE.match(filename)
    return stored_match.group(1) if stored_match else filename


def _issue_payload(notification):
    data = notification.data or {}
    issue = data.get("issue") or {}
    activity = data.get("issue_activity") or {}
    identifier = issue.get("identifier") or ""
    sequence_id = issue.get("sequence_id")
    issue_key = f"{identifier}-{sequence_id}" if identifier and sequence_id is not None else ""
    workspace_slug = notification.workspace.slug
    category = notification_category(notification)
    field = activity.get("field") or ""
    comment_source = activity.get("issue_comment")
    if not comment_source and category in TELEGRAM_COMMENT_CATEGORIES:
        comment_source = activity.get("new_value")
    return {
        "kind": "issue",
        "workspace_slug": workspace_slug,
        "project_id": str(notification.project_id) if notification.project_id else None,
        "issue_id": str(notification.entity_identifier) if notification.entity_identifier else None,
        "issue_key": issue_key,
        "issue_name": issue.get("name") or notification.title or "",
        "actor_name": user_name(notification.triggered_by) if notification.triggered_by else "GTS Tasks System",
        "field": field,
        "old_value": _resolved_activity_value(activity, "old"),
        "new_value": _resolved_activity_value(activity, "new"),
        "comment": telegram_plain_text(comment_source),
        "attachment_event": ("removed" if activity.get("verb") == "deleted" else "added")
        if field in TELEGRAM_ATTACHMENT_FIELDS
        else "",
        "attachment_name": _attachment_filename(activity.get("new_value"))
        if field in TELEGRAM_ATTACHMENT_FIELDS
        else "",
        "url": application_url(f"{workspace_slug}/browse/{issue_key}/") if issue_key else application_url(""),
    }


def _meeting_payload(notification):
    meeting = (notification.data or {}).get("meeting") or {}
    workspace_slug = notification.workspace.slug
    meeting_id = meeting.get("id") or str(notification.entity_identifier or "")
    return {
        "kind": "meeting",
        "workspace_slug": workspace_slug,
        "project_id": str(notification.project_id) if notification.project_id else None,
        "meeting_id": meeting_id,
        "meeting_title": meeting.get("title") or notification.title or "",
        "event": meeting.get("event") or (notification.message or {}).get("event") or "UPDATED",
        "starts_at": meeting.get("starts_at"),
        "ends_at": meeting.get("ends_at"),
        "changes": meeting.get("changes") or {},
        "participant_name": meeting.get("participant_name"),
        "response_status": meeting.get("response_status") or (notification.message or {}).get("response_status"),
        "actor_name": user_name(notification.triggered_by) if notification.triggered_by else "GTS Tasks System",
        "url": application_url(f"{workspace_slug}/calendar?meeting={meeting_id}"),
    }


def _project_announcement_payload(notification):
    announcement = (notification.data or {}).get("project_announcement") or {}
    workspace_slug = notification.workspace.slug
    announcement_id = announcement.get("id") or str(notification.entity_identifier or "")
    attachment_rows = []
    recipient = getattr(notification, "project_announcement_recipient", None)
    if recipient:
        attachment_rows = list(recipient.announcement.attachments.select_related("asset").all())
    return {
        "kind": "project_announcement",
        "announcement_type": announcement.get("type") or "standard",
        "project_name": announcement.get("project_name") or getattr(notification.project, "name", ""),
        "title": announcement.get("title") or notification.title or "",
        "content": notification.message_stripped or "",
        "actor_name": user_name(notification.triggered_by) if notification.triggered_by else "GTS Tasks System",
        "attachments": [
            {
                "name": row.asset.attributes.get("name") or "attachment",
                "url": application_url(
                    f"api/workspaces/{workspace_slug}/project-announcements/{announcement_id}/"
                    f"attachments/{row.id}/?disposition=attachment"
                ),
            }
            for row in attachment_rows
        ],
        "url": application_url(f"{workspace_slug}/notifications/announcements/{announcement_id}"),
    }


def enqueue_telegram_notifications(notifications):
    notifications = list(notifications)
    if not notifications or not telegram_configuration()["enabled"]:
        return []
    receiver_ids = {str(notification.receiver_id) for notification in notifications}
    connections = {
        str(connection.user_id): connection
        for connection in TelegramUserConnection.objects.filter(
            user_id__in=receiver_ids,
            status=TelegramUserConnection.Status.CONNECTED,
            user__is_active=True,
            user__blocked_at__isnull=True,
        ).select_related("user")
    }
    preferences = {
        str(preference.user_id): preference
        for preference in TelegramNotificationPreference.objects.filter(user_id__in=receiver_ids)
    }
    deliveries = []
    for notification in notifications:
        receiver_id = str(notification.receiver_id)
        connection = connections.get(receiver_id)
        if not connection or (
            notification.entity_name != "project_announcement"
            and str(notification.triggered_by_id or "") == receiver_id
        ):
            continue
        preference = preferences.get(receiver_id) or preference_for(connection.user)
        category = notification_category(notification)
        if not preference.enabled or not getattr(preference, category, False):
            continue
        if notification.entity_name == "meeting":
            payload = _meeting_payload(notification)
        elif notification.entity_name == "project_announcement":
            payload = _project_announcement_payload(notification)
        else:
            payload = _issue_payload(notification)
        deliveries.append(
            TelegramDelivery(
                connection=connection,
                receiver_id=connection.user_id,
                notification=notification if notification.pk else None,
                workspace_id=notification.workspace_id,
                project_id=notification.project_id,
                issue_id=notification.entity_identifier if notification.entity_name == "issue" else None,
                category=category,
                payload=payload,
                available_at=quiet_hours_available_at(connection.user, preference),
                idempotency_key=f"notification:{notification.id}",
            )
        )
    TelegramDelivery.objects.bulk_create(deliveries, ignore_conflicts=True)
    created = list(
        TelegramDelivery.objects.filter(
            idempotency_key__in=[delivery.idempotency_key for delivery in deliveries]
        ).order_by("created_at")
    )
    if created:
        from plane.bgtasks.telegram_notification_task import deliver_telegram_delivery

        now = timezone.now()
        for delivery in created:
            if delivery.id and delivery.available_at <= now:
                deliver_telegram_delivery.delay(str(delivery.id))
    return created


def enqueue_system_telegram_notification(
    *,
    user,
    category,
    event,
    context=None,
    actor=None,
    allow_inactive=False,
    respect_preferences=True,
    idempotency_key=None,
):
    if category not in {"role_change", "account_activity"}:
        raise ValueError("Unsupported system Telegram category")
    configuration = telegram_configuration()
    if not configuration["enabled"] or (not allow_inactive and (not user.is_active or user.blocked_at is not None)):
        return None
    connection = TelegramUserConnection.objects.filter(
        user=user, status=TelegramUserConnection.Status.CONNECTED
    ).first()
    if not connection or (actor and actor.id == user.id):
        return None
    preference = preference_for(user)
    if respect_preferences and (not preference.enabled or not getattr(preference, category, False)):
        return None
    context = context or {}
    payload = {
        "kind": "system",
        "event": event,
        "actor_name": user_name(actor) if actor else "GTS Tasks System",
        **context,
    }
    if allow_inactive:
        payload["allow_inactive"] = True
    signature = hashlib.sha256(f"{user.id}:{category}:{event}:{timezone.now().isoformat()}".encode()).hexdigest()
    delivery = TelegramDelivery.objects.create(
        connection=connection,
        receiver=user,
        workspace_id=context.get("workspace_id"),
        project_id=context.get("project_id"),
        category=category,
        payload=payload,
        available_at=quiet_hours_available_at(user, preference),
        idempotency_key=idempotency_key or f"system:{signature}",
    )
    if delivery.available_at <= timezone.now():
        from plane.bgtasks.telegram_notification_task import deliver_telegram_delivery

        deliver_telegram_delivery.delay(str(delivery.id))
    return delivery


TRANSLATIONS = {
    "en": {
        "task_assignment": "You were assigned to a task",
        "mention": "You were mentioned in a task",
        "comment": "New comment on a task",
        "state_change": "Task status changed",
        "issue_completed": "Task completed",
        "priority": "Task priority changed",
        "due_date": "Task date changed",
        "property_change": "Task property changed",
        "attachment_added": "File attached to a task",
        "attachment_removed": "File removed from a task",
        "role_change": "Access changed",
        "account_activity": "Account notification",
        "project_announcement": "Project notification",
        "project_announcement_important": "Important project notification",
        "open_notification": "Open notification",
        "attachments": "Attachments",
        "open_task": "Open task",
        "open_settings": "Open settings",
        "open_project": "Open project",
        "open_workspace": "Open workspace",
        "open_account": "Open account",
        "open_home": "Open GTS Tasks",
        "open_calendar": "Open calendar",
        "meeting_CREATED": "Meeting invitation",
        "meeting_UPDATED": "Meeting updated",
        "meeting_CANCELLED": "Meeting cancelled",
        "meeting_REMINDER": "Meeting reminder",
        "meeting_RSVP_CHANGED": "Invitation response",
        "meeting_changes": "Changes",
        "meeting_updated": "Updated",
        "meeting_participant": "Participant",
        "meeting_response": "Response",
        "meeting_response_ACCEPTED": "Accepted",
        "meeting_response_TENTATIVE": "Maybe",
        "meeting_response_DECLINED": "Declined",
        "meeting_response_NO_RESPONSE": "No response",
        "meeting_field_title": "Title",
        "meeting_field_starts_at": "Start",
        "meeting_field_ends_at": "End",
        "meeting_field_all_day": "All day",
        "meeting_field_location": "Location",
        "meeting_field_description": "Description",
        "meeting_field_agenda": "Agenda",
        "meeting_field_timezone": "Time zone",
        "meeting_field_attendance_mode": "Format",
        "meeting_field_meeting_url": "Meeting link",
        "meeting_field_google_meet_open_access": "Google Meet access",
        "meeting_field_visibility": "Visibility",
        "meeting_field_availability": "Availability",
        "meeting_field_recurrence_rule": "Repeat",
        "meeting_field_recurrence_timezone": "Repeat time zone",
        "meeting_field_recurrence_until": "Repeat until",
        "meeting_field_project": "Project",
        "meeting_field_issue": "Task",
        "meeting_field_meeting_type": "Meeting type",
        "meeting_field_participants": "Participants",
        "meeting_field_reminders": "Reminders",
        "meeting_field_organizer": "Organizer",
        "meeting_field_occurrence": "Occurrence",
        "meeting_value_ONLINE": "Online",
        "meeting_value_MIXED": "Online and in person",
        "meeting_value_OFFLINE": "In person",
        "meeting_value_PROJECT": "Project",
        "meeting_value_PERSONAL": "Personal",
        "meeting_value_PRIVATE": "Private",
        "meeting_value_BUSY": "Busy",
        "meeting_value_FREE": "Free",
        "meeting_value_MAYBE": "Maybe",
        "meeting_value_AWAY": "Away",
        "meeting_value_UPDATED": "Updated",
        "meeting_value_CANCELLED": "Cancelled",
        "when": "When",
        "organizer": "Organizer",
        "field": "Field",
        "old": "Was",
        "new": "Now",
        "comment_excerpt": "Comment",
        "changed_by": "Changed by",
        "file": "File",
        "not_set": "Not set",
        "mention_without_text": "You were mentioned without an additional message.",
        "yes": "Yes",
        "no": "No",
        "field_assignees": "Assignees",
        "field_state": "Status",
        "field_priority": "Priority",
        "field_start_date": "Start date",
        "field_target_date": "Due date",
        "field_cycle": "Cycle",
        "field_module": "Module",
        "field_estimate": "Estimate",
        "field_labels": "Labels",
        "field_parent": "Parent task",
        "field_name": "Title",
        "field_description": "Description",
        "field_link": "Link",
        "field_attachment": "Attachment",
        "priority_urgent": "Urgent",
        "priority_high": "High",
        "priority_medium": "Medium",
        "priority_low": "Low",
    },
    "ru": {
        "task_assignment": "Вас назначили на задачу",
        "mention": "Вас упомянули в задаче",
        "comment": "Новый комментарий к задаче",
        "state_change": "Статус задачи изменён",
        "issue_completed": "Задача завершена",
        "priority": "Приоритет задачи изменён",
        "due_date": "Дата задачи изменена",
        "property_change": "Свойство задачи изменено",
        "attachment_added": "К задаче прикреплён файл",
        "attachment_removed": "Из задачи удалён файл",
        "role_change": "Права доступа изменены",
        "account_activity": "Уведомление об аккаунте",
        "project_announcement": "Уведомление проекта",
        "project_announcement_important": "Важное уведомление проекта",
        "open_notification": "Открыть уведомление",
        "attachments": "Вложения",
        "open_task": "Открыть задачу",
        "open_settings": "Открыть настройки",
        "open_project": "Открыть проект",
        "open_workspace": "Открыть рабочее пространство",
        "open_account": "Открыть аккаунт",
        "open_home": "Открыть GTS Tasks",
        "open_calendar": "Открыть календарь",
        "meeting_CREATED": "Приглашение на встречу",
        "meeting_UPDATED": "Встреча изменена",
        "meeting_CANCELLED": "Встреча отменена",
        "meeting_REMINDER": "Напоминание о встрече",
        "meeting_RSVP_CHANGED": "Ответ на приглашение",
        "meeting_changes": "Что изменилось",
        "meeting_updated": "Обновлено",
        "meeting_participant": "Участник",
        "meeting_response": "Ответ",
        "meeting_response_ACCEPTED": "Принято",
        "meeting_response_TENTATIVE": "Возможно",
        "meeting_response_DECLINED": "Отклонено",
        "meeting_response_NO_RESPONSE": "Нет ответа",
        "meeting_field_title": "Название",
        "meeting_field_starts_at": "Начало",
        "meeting_field_ends_at": "Окончание",
        "meeting_field_all_day": "Весь день",
        "meeting_field_location": "Место",
        "meeting_field_description": "Описание",
        "meeting_field_agenda": "Повестка",
        "meeting_field_timezone": "Часовой пояс",
        "meeting_field_attendance_mode": "Формат",
        "meeting_field_meeting_url": "Ссылка на встречу",
        "meeting_field_google_meet_open_access": "Доступ к Google Meet",
        "meeting_field_visibility": "Доступ",
        "meeting_field_availability": "Занятость",
        "meeting_field_recurrence_rule": "Повтор",
        "meeting_field_recurrence_timezone": "Часовой пояс повтора",
        "meeting_field_recurrence_until": "Повторять до",
        "meeting_field_project": "Проект",
        "meeting_field_issue": "Задача",
        "meeting_field_meeting_type": "Тип встречи",
        "meeting_field_participants": "Участники",
        "meeting_field_reminders": "Напоминания",
        "meeting_field_organizer": "Организатор",
        "meeting_field_occurrence": "Экземпляр встречи",
        "meeting_value_ONLINE": "Онлайн",
        "meeting_value_MIXED": "Онлайн и очно",
        "meeting_value_OFFLINE": "Очно",
        "meeting_value_PROJECT": "Проектная",
        "meeting_value_PERSONAL": "Личная",
        "meeting_value_PRIVATE": "Закрытая",
        "meeting_value_BUSY": "Занят",
        "meeting_value_FREE": "Свободен",
        "meeting_value_MAYBE": "Возможно занят",
        "meeting_value_AWAY": "Нет на месте",
        "meeting_value_UPDATED": "Обновлено",
        "meeting_value_CANCELLED": "Отменено",
        "when": "Когда",
        "organizer": "Организатор",
        "field": "Поле",
        "old": "Было",
        "new": "Стало",
        "comment_excerpt": "Комментарий",
        "changed_by": "Изменил",
        "file": "Файл",
        "not_set": "Не указано",
        "mention_without_text": "Вас упомянули без дополнительного сообщения.",
        "yes": "Да",
        "no": "Нет",
        "field_assignees": "Исполнители",
        "field_state": "Статус",
        "field_priority": "Приоритет",
        "field_start_date": "Начальная дата",
        "field_target_date": "Срок выполнения",
        "field_cycle": "Цикл",
        "field_module": "Модуль",
        "field_estimate": "Оценка",
        "field_labels": "Метки",
        "field_parent": "Родительская задача",
        "field_name": "Название",
        "field_description": "Описание",
        "field_link": "Ссылка",
        "field_attachment": "Вложение",
        "priority_urgent": "Срочный",
        "priority_high": "Высокий",
        "priority_medium": "Средний",
        "priority_low": "Низкий",
    },
    "uz": {
        "task_assignment": "Siz vazifaga tayinlandingiz",
        "mention": "Vazifada siz eslatildingiz",
        "comment": "Vazifaga yangi izoh",
        "state_change": "Vazifa holati o‘zgardi",
        "issue_completed": "Vazifa yakunlandi",
        "priority": "Vazifa ustuvorligi o‘zgardi",
        "due_date": "Vazifa sanasi o‘zgardi",
        "property_change": "Vazifa xususiyati o‘zgardi",
        "attachment_added": "Vazifaga fayl biriktirildi",
        "attachment_removed": "Vazifadan fayl olib tashlandi",
        "role_change": "Kirish huquqlari o‘zgardi",
        "account_activity": "Hisob bildirishnomasi",
        "project_announcement": "Loyiha bildirishnomasi",
        "project_announcement_important": "Muhim loyiha bildirishnomasi",
        "open_notification": "Bildirishnomani ochish",
        "attachments": "Ilovalar",
        "open_task": "Vazifani ochish",
        "open_settings": "Sozlamalarni ochish",
        "open_project": "Loyihani ochish",
        "open_workspace": "Ish maydonini ochish",
        "open_account": "Hisobni ochish",
        "open_home": "GTS Tasks-ni ochish",
        "open_calendar": "Kalendarni ochish",
        "meeting_CREATED": "Uchrashuvga taklif",
        "meeting_UPDATED": "Uchrashuv o‘zgartirildi",
        "meeting_CANCELLED": "Uchrashuv bekor qilindi",
        "meeting_REMINDER": "Uchrashuv eslatmasi",
        "meeting_RSVP_CHANGED": "Taklifga javob",
        "meeting_changes": "Nima o‘zgardi",
        "meeting_updated": "Yangilandi",
        "meeting_participant": "Ishtirokchi",
        "meeting_response": "Javob",
        "meeting_response_ACCEPTED": "Qabul qilindi",
        "meeting_response_TENTATIVE": "Ehtimol",
        "meeting_response_DECLINED": "Rad etildi",
        "meeting_response_NO_RESPONSE": "Javob yo‘q",
        "meeting_field_title": "Nomi",
        "meeting_field_starts_at": "Boshlanishi",
        "meeting_field_ends_at": "Tugashi",
        "meeting_field_all_day": "Kun bo‘yi",
        "meeting_field_location": "Joy",
        "meeting_field_description": "Tavsif",
        "meeting_field_agenda": "Kun tartibi",
        "meeting_field_timezone": "Vaqt mintaqasi",
        "meeting_field_attendance_mode": "Format",
        "meeting_field_meeting_url": "Uchrashuv havolasi",
        "meeting_field_google_meet_open_access": "Google Meet kirishi",
        "meeting_field_visibility": "Kirish",
        "meeting_field_availability": "Bandlik",
        "meeting_field_recurrence_rule": "Takrorlash",
        "meeting_field_recurrence_timezone": "Takrorlash vaqt mintaqasi",
        "meeting_field_recurrence_until": "Takrorlash muddati",
        "meeting_field_project": "Loyiha",
        "meeting_field_issue": "Vazifa",
        "meeting_field_meeting_type": "Uchrashuv turi",
        "meeting_field_participants": "Ishtirokchilar",
        "meeting_field_reminders": "Eslatmalar",
        "meeting_field_organizer": "Tashkilotchi",
        "meeting_field_occurrence": "Uchrashuv nusxasi",
        "meeting_value_ONLINE": "Onlayn",
        "meeting_value_MIXED": "Onlayn va oflayn",
        "meeting_value_OFFLINE": "Oflayn",
        "meeting_value_PROJECT": "Loyiha",
        "meeting_value_PERSONAL": "Shaxsiy",
        "meeting_value_PRIVATE": "Yopiq",
        "meeting_value_BUSY": "Band",
        "meeting_value_FREE": "Bo‘sh",
        "meeting_value_MAYBE": "Ehtimol band",
        "meeting_value_AWAY": "Joyida emas",
        "meeting_value_UPDATED": "Yangilandi",
        "meeting_value_CANCELLED": "Bekor qilindi",
        "when": "Vaqti",
        "organizer": "Tashkilotchi",
        "field": "Maydon",
        "old": "Oldin",
        "new": "Hozir",
        "comment_excerpt": "Izoh",
        "changed_by": "O‘zgartirgan",
        "file": "Fayl",
        "not_set": "Ko‘rsatilmagan",
        "mention_without_text": "Siz qo‘shimcha xabarsiz eslatildingiz.",
        "yes": "Ha",
        "no": "Yo‘q",
        "field_assignees": "Ijrochilar",
        "field_state": "Holat",
        "field_priority": "Ustuvorlik",
        "field_start_date": "Boshlanish sanasi",
        "field_target_date": "Tugash muddati",
        "field_cycle": "Sikl",
        "field_module": "Modul",
        "field_estimate": "Baholash",
        "field_labels": "Belgilar",
        "field_parent": "Yuqori vazifa",
        "field_name": "Nomi",
        "field_description": "Tavsif",
        "field_link": "Havola",
        "field_attachment": "Ilova",
        "priority_urgent": "Shoshilinch",
        "priority_high": "Yuqori",
        "priority_medium": "O‘rta",
        "priority_low": "Past",
    },
}


TELEGRAM_FIELD_ALIASES = {
    "assignee": "assignees",
    "assignee_ids": "assignees",
    "due_date": "target_date",
    "estimate_point": "estimate",
    "estimate_points": "estimate",
    "label": "labels",
    "module_id": "module",
    "cycle_id": "cycle",
    "parent_id": "parent",
    "attachments": "attachment",
}
TELEGRAM_DATE_FIELDS = {"start_date", "target_date", "due_date"}
TELEGRAM_PRIORITY_VALUES = {"urgent", "high", "medium", "low"}


def _field_label(field, strings):
    normalized = TELEGRAM_FIELD_ALIASES.get(field, field)
    translated = strings.get(f"field_{normalized}")
    if translated:
        return translated
    return str(field).replace("_", " ").strip().capitalize() or strings["field"]


def _date_value(value, language):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if language == "en":
        return parsed.strftime("%b %d, %Y")
    return parsed.strftime("%d.%m.%Y")


def _meeting_datetime(value, user, language):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        parsed = parsed.astimezone(ZoneInfo(user.user_timezone or "UTC"))
    except (TypeError, ValueError, KeyError):
        return ""
    if language == "en":
        return parsed.strftime("%b %d, %Y %H:%M")
    return parsed.strftime("%d.%m.%Y %H:%M")


def _meeting_change_value(value, field, user, language, strings):
    if field in {"starts_at", "ends_at", "recurrence_until", "occurrence"}:
        formatted = _meeting_datetime(value, user, language)
        if formatted:
            return formatted
    translated = strings.get(f"meeting_value_{str(value)}")
    if translated:
        return translated
    return _activity_value(value, field, language, strings)


def _meeting_change_lines(changes, user, language, strings):
    if not isinstance(changes, dict) or not changes:
        return []
    lines = ["", f"<b>{html.escape(strings['meeting_changes'])}:</b>"]
    opaque_fields = {"project", "issue", "meeting_type", "participants", "reminders"}
    for field, change in changes.items():
        label = strings.get(f"meeting_field_{field}") or str(field).replace("_", " ").capitalize()
        if field in opaque_fields or not isinstance(change, dict):
            lines.append(f"• {html.escape(label)}: {html.escape(strings['meeting_updated'])}")
            continue
        old_value = _meeting_change_value(change.get("from"), field, user, language, strings)
        new_value = _meeting_change_value(change.get("to"), field, user, language, strings)
        lines.append(f"• {html.escape(label)}: {html.escape(old_value)} → {html.escape(new_value)}")
    return lines


def _activity_value(value, field, language, strings):
    if value is None or str(value).strip().lower() in TELEGRAM_EMPTY_VALUES:
        return strings["not_set"]
    normalized_field = TELEGRAM_FIELD_ALIASES.get(field, field)
    normalized_value = str(value).strip()
    if normalized_field in TELEGRAM_DATE_FIELDS:
        formatted_date = _date_value(normalized_value, language)
        if formatted_date:
            return formatted_date
    priority = normalized_value.lower().replace(" ", "_")
    if normalized_field == "priority":
        if priority in TELEGRAM_EMPTY_VALUES | {"no_priority"}:
            return strings["not_set"]
        if priority in TELEGRAM_PRIORITY_VALUES:
            return strings[f"priority_{priority}"]
    if normalized_value.lower() == "true":
        return strings["yes"]
    if normalized_value.lower() == "false":
        return strings["no"]
    return telegram_plain_text(normalized_value, limit=500) or strings["not_set"]


def _system_button_key(payload):
    if payload.get("button_key"):
        return payload["button_key"]
    event = payload.get("event") or ""
    if event.startswith("project_"):
        return "open_project"
    if event.startswith("workspace_"):
        return "open_workspace"
    if event.startswith("account_"):
        return "open_account"
    if event == "creation_quota_changed":
        return "open_home"
    return "open_settings"


def render_delivery(delivery):
    profile = getattr(delivery.receiver, "profile", None)
    language = getattr(profile, "language", "en") or "en"
    strings = TRANSLATIONS.get(language, TRANSLATIONS["en"])
    payload = delivery.payload or {}
    if payload.get("kind") == "system":
        title = strings.get(delivery.category, strings["account_activity"])
        localized = payload.get("localized") or {}
        body = localized.get(language) or localized.get("en") or payload.get("message") or payload.get("event", "")
        lines = [f"<b>{html.escape(title)}</b>", "", html.escape(str(body))]
        if payload.get("actor_name"):
            lines.extend(["", f"{strings['changed_by']}: {html.escape(str(payload['actor_name']))}"])
        text = "\n".join(lines)
        url = payload.get("url") or application_url("")
        button = strings[_system_button_key(payload)]
    elif payload.get("kind") == "meeting":
        event = payload.get("event") or "UPDATED"
        title = strings.get(f"meeting_{event}", strings["account_activity"])
        lines = [
            f"<b>{html.escape(title)}</b>",
            "",
            f"<b>{html.escape(str(payload.get('meeting_title') or ''))}</b>",
        ]
        starts_at = _meeting_datetime(payload.get("starts_at"), delivery.receiver, language)
        if starts_at:
            lines.append(f"{strings['when']}: {html.escape(starts_at)}")
        if event == "RSVP_CHANGED":
            participant_name = payload.get("participant_name") or payload.get("actor_name") or ""
            response_status = payload.get("response_status") or "NO_RESPONSE"
            response_label = strings.get(f"meeting_response_{response_status}", str(response_status))
            lines.extend(
                [
                    f"{strings['meeting_participant']}: {html.escape(str(participant_name))}",
                    f"{strings['meeting_response']}: {html.escape(str(response_label))}",
                ]
            )
        elif payload.get("actor_name"):
            actor_label = strings["changed_by"] if event == "UPDATED" else strings["organizer"]
            lines.append(f"{actor_label}: {html.escape(str(payload['actor_name']))}")
        if event == "UPDATED":
            lines.extend(_meeting_change_lines(payload.get("changes"), delivery.receiver, language, strings))
        text = "\n".join(lines)
        url = payload.get("url") or application_url("")
        button = strings["open_calendar"]
    elif payload.get("kind") == "project_announcement":
        title_key = (
            "project_announcement_important"
            if payload.get("announcement_type") == "important"
            else "project_announcement"
        )
        lines = [
            strings[title_key],
            str(payload.get("project_name") or ""),
            "",
            str(payload.get("title") or ""),
            "",
            str(payload.get("content") or ""),
        ]
        attachments = payload.get("attachments") or []
        if attachments:
            lines.extend(["", f"{strings['attachments']}:"])
            lines.extend(f"• {row.get('name')}: {row.get('url')}" for row in attachments)
        text = "\n".join(lines)
        url = payload.get("url") or application_url("")
        button = strings["open_notification"]
    else:
        attachment_event = payload.get("attachment_event")
        title_key = f"attachment_{attachment_event}" if attachment_event else delivery.category
        title = strings.get(title_key, strings.get(delivery.category, strings["account_activity"]))
        key = payload.get("issue_key") or ""
        name = payload.get("issue_name") or ""
        actor = payload.get("actor_name") or "GTS Tasks System"
        lines = [
            f"<b>{html.escape(title)}</b>",
            "",
            f"<b>{html.escape(key)}</b> — {html.escape(name)}",
            html.escape(actor),
        ]
        if delivery.category in TELEGRAM_COMMENT_CATEGORIES:
            comment = payload.get("comment") or (
                strings["mention_without_text"] if delivery.category == "mention" else ""
            )
            if comment:
                lines.extend(["", html.escape(str(comment)[:TELEGRAM_COMMENT_LIMIT])])
        elif attachment_event:
            if payload.get("attachment_name"):
                lines.extend(["", f"{strings['file']}: {html.escape(str(payload['attachment_name']))}"])
        else:
            if payload.get("field"):
                field = str(payload["field"])
                lines.append(f"{strings['field']}: {html.escape(_field_label(field, strings))}")
                old_value = _activity_value(payload.get("old_value"), field, language, strings)
                new_value = _activity_value(payload.get("new_value"), field, language, strings)
                lines.append(f"{strings['old']}: {html.escape(old_value)}")
                lines.append(f"{strings['new']}: {html.escape(new_value)}")
        text = "\n".join(lines)
        url = payload.get("url") or application_url("")
        button = strings["open_task"]
    rendered = {
        "chat_id": delivery.connection.chat_id,
        "text": text if payload.get("kind") == "project_announcement" else text[:4096],
        "parse_mode": None if payload.get("kind") == "project_announcement" else "HTML",
        "disable_web_page_preview": True,
        "reply_markup": {"inline_keyboard": [[{"text": button, "url": url}]]},
        "split_long": payload.get("kind") == "project_announcement",
    }
    if rendered["parse_mode"] is None:
        rendered.pop("parse_mode")
    return rendered


def may_deliver(delivery):
    user = delivery.receiver
    if (not user.is_active or user.blocked_at is not None) and not (delivery.payload or {}).get("allow_inactive"):
        return False
    if delivery.project_id and delivery.issue_id:
        issue = Issue.unscoped_objects.filter(
            id=delivery.issue_id,
            project_id=delivery.project_id,
        ).first()
        if not issue:
            return False
        if issue.visibility == IssueVisibility.RESTRICTED:
            return can_view_issue(user, issue)
        return ProjectMember.objects.filter(
            project_id=delivery.project_id,
            member=user,
            is_active=True,
        ).exists()
    return True
