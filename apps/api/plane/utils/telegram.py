# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import html
from datetime import datetime, time, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.utils import timezone

from plane.db.models import (
    ProjectMember,
    State,
    TelegramDelivery,
    TelegramNotificationPreference,
    TelegramUserConnection,
)
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import decrypt_data, encrypt_data


TELEGRAM_SECRET_CONFIGURATION_KEYS = {
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_PROXY_URL",
}
TELEGRAM_CONFIGURATION_KEYS = TELEGRAM_SECRET_CONFIGURATION_KEYS | {
    "TELEGRAM_BOT_ID",
    "TELEGRAM_BOT_USERNAME",
    "ENABLE_TELEGRAM",
}
TELEGRAM_PROXY_SCHEMES = {"http", "https", "socks5", "socks5h"}

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
}


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


def save_telegram_configuration(*, token, webhook_secret, bot_id, bot_username, enabled=True, proxy_url=""):
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
    for key, (value, encrypted) in values.items():
        stored_value = encrypt_data(value) if encrypted else value
        InstanceConfiguration.objects.update_or_create(
            key=key,
            defaults={"value": stored_value, "category": "TELEGRAM", "is_encrypted": encrypted},
        )


def clear_telegram_configuration():
    InstanceConfiguration.objects.filter(key__in=TELEGRAM_CONFIGURATION_KEYS).delete()


def telegram_api_call(method, payload=None, *, token=None, timeout=15, proxy_url=None):
    configuration = telegram_configuration()
    bot_token = token or configuration["token"]
    if not bot_token:
        raise TelegramAPIError("Telegram bot is not configured")
    effective_proxy_url = configuration["proxy_url"] if proxy_url is None else validate_telegram_proxy_url(proxy_url)
    proxies = {"http": effective_proxy_url, "https": effective_proxy_url} if effective_proxy_url else None
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{bot_token}/{method}",
            json=payload or {},
            timeout=timeout,
            proxies=proxies,
        )
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        message = "Telegram proxy is unavailable" if effective_proxy_url else "Telegram API is unavailable"
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


def _issue_payload(notification):
    data = notification.data or {}
    issue = data.get("issue") or {}
    activity = data.get("issue_activity") or {}
    identifier = issue.get("identifier") or ""
    sequence_id = issue.get("sequence_id")
    issue_key = f"{identifier}-{sequence_id}" if identifier and sequence_id is not None else ""
    workspace_slug = notification.workspace.slug
    return {
        "kind": "issue",
        "workspace_slug": workspace_slug,
        "project_id": str(notification.project_id) if notification.project_id else None,
        "issue_id": str(notification.entity_identifier) if notification.entity_identifier else None,
        "issue_key": issue_key,
        "issue_name": issue.get("name") or notification.title or "",
        "actor_name": user_name(notification.triggered_by) if notification.triggered_by else "GTS Tasks System",
        "field": activity.get("field") or "",
        "old_value": activity.get("old_value") or "",
        "new_value": activity.get("new_value") or "",
        "comment": (activity.get("issue_comment") or "")[:300],
        "url": application_url(f"{workspace_slug}/browse/{issue_key}/") if issue_key else application_url(""),
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
        if not connection or str(notification.triggered_by_id or "") == receiver_id:
            continue
        preference = preferences.get(receiver_id) or preference_for(connection.user)
        category = notification_category(notification)
        if not preference.enabled or not getattr(preference, category, False):
            continue
        payload = _issue_payload(notification)
        deliveries.append(
            TelegramDelivery(
                connection=connection,
                receiver_id=connection.user_id,
                notification=notification if notification.pk else None,
                workspace_id=notification.workspace_id,
                project_id=notification.project_id,
                issue_id=notification.entity_identifier,
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


def enqueue_system_telegram_notification(*, user, category, event, context=None, actor=None, allow_inactive=False):
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
    if not preference.enabled or not getattr(preference, category, False):
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
        idempotency_key=f"system:{signature}",
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
        "role_change": "Access changed",
        "account_activity": "Account notification",
        "open_task": "Open task",
        "open_settings": "Open settings",
        "field": "Field",
        "old": "Was",
        "new": "Now",
        "comment_excerpt": "Comment",
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
        "role_change": "Права доступа изменены",
        "account_activity": "Уведомление об аккаунте",
        "open_task": "Открыть задачу",
        "open_settings": "Открыть настройки",
        "field": "Поле",
        "old": "Было",
        "new": "Стало",
        "comment_excerpt": "Комментарий",
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
        "role_change": "Kirish huquqlari o‘zgardi",
        "account_activity": "Hisob bildirishnomasi",
        "open_task": "Vazifani ochish",
        "open_settings": "Sozlamalarni ochish",
        "field": "Maydon",
        "old": "Oldin",
        "new": "Hozir",
        "comment_excerpt": "Izoh",
    },
}


def render_delivery(delivery):
    language = getattr(delivery.receiver.profile, "language", "en") or "en"
    strings = TRANSLATIONS.get(language, TRANSLATIONS["en"])
    payload = delivery.payload or {}
    title = strings.get(delivery.category, strings["account_activity"])
    if payload.get("kind") == "system":
        localized = payload.get("localized") or {}
        body = localized.get(language) or localized.get("en") or payload.get("message") or payload.get("event", "")
        text = f"<b>{html.escape(title)}</b>\n\n{html.escape(str(body))}"
        url = payload.get("url") or application_url("")
        button = strings["open_settings"]
    else:
        key = payload.get("issue_key") or ""
        name = payload.get("issue_name") or ""
        actor = payload.get("actor_name") or "GTS Tasks System"
        lines = [
            f"<b>{html.escape(title)}</b>",
            "",
            f"<b>{html.escape(key)}</b> — {html.escape(name)}",
            html.escape(actor),
        ]
        if payload.get("field"):
            lines.append(f"{strings['field']}: {html.escape(str(payload['field']))}")
        if payload.get("old_value"):
            lines.append(f"{strings['old']}: {html.escape(str(payload['old_value']))}")
        if payload.get("new_value"):
            lines.append(f"{strings['new']}: {html.escape(str(payload['new_value']))}")
        if payload.get("comment"):
            lines.append(f"{strings['comment_excerpt']}: {html.escape(str(payload['comment'])[:300])}")
        text = "\n".join(lines)
        url = payload.get("url") or application_url("")
        button = strings["open_task"]
    return {
        "chat_id": delivery.connection.chat_id,
        "text": text[:4096],
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "reply_markup": {"inline_keyboard": [[{"text": button, "url": url}]]},
    }


def may_deliver(delivery):
    user = delivery.receiver
    if (not user.is_active or user.blocked_at is not None) and not (delivery.payload or {}).get("allow_inactive"):
        return False
    if delivery.project_id and delivery.issue_id:
        return ProjectMember.objects.filter(
            project_id=delivery.project_id,
            member=user,
            is_active=True,
        ).exists()
    return True
