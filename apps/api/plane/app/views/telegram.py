# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.rate_limit import AuthenticationThrottle
from plane.authentication.utils.login import user_login
from plane.app.serializers.telegram import TelegramNotificationPreferenceSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    TelegramDelivery,
    TelegramLinkToken,
    TelegramUserConnection,
    Workspace,
)
from plane.utils.telegram import (
    TelegramWebAppDataError,
    application_url,
    preference_for,
    telegram_configuration,
    validate_telegram_web_app_init_data,
)


COMMAND_TEXT = {
    "en": {
        "welcome": "Telegram notifications are connected to GTS Tasks System.",
        "paused": "Notifications are paused. New notifications will be skipped until /resume.",
        "resumed": "Notifications are enabled again.",
        "connected": "Telegram notifications are connected and active.",
        "disconnected": "Telegram notifications are disconnected.",
        "invalid": "This connection link is invalid or has expired. Create a new link in GTS Tasks System.",
        "inactive": "Your GTS Tasks System account is blocked or inactive.",
        "help": "Commands: /tasks, /status, /pause, /resume, /settings, /disconnect",
        "settings": "Open notification settings in GTS Tasks System.",
        "open_settings": "Open settings",
        "tasks": "Open your GTS Tasks System tasks.",
        "open_tasks": "Tasks",
        "test": "GTS Tasks System: Telegram connection test completed successfully.",
    },
    "ru": {
        "welcome": "Telegram-уведомления подключены к GTS Tasks System.",
        "paused": "Уведомления приостановлены. Новые уведомления будут пропускаться до команды /resume.",
        "resumed": "Уведомления снова включены.",
        "connected": "Telegram-уведомления подключены и активны.",
        "disconnected": "Telegram-уведомления отключены.",
        "invalid": "Ссылка недействительна или истекла. Создайте новую ссылку в GTS Tasks System.",
        "inactive": "Ваш аккаунт GTS Tasks System заблокирован или неактивен.",
        "help": "Команды: /tasks, /status, /pause, /resume, /settings, /disconnect",
        "settings": "Откройте настройки уведомлений в GTS Tasks System.",
        "open_settings": "Открыть настройки",
        "tasks": "Откройте доступные вам задачи GTS Tasks System.",
        "open_tasks": "Задачи",
        "test": "GTS Tasks System: проверка подключения Telegram успешно завершена.",
    },
    "uz": {
        "welcome": "Telegram bildirishnomalari GTS Tasks System bilan ulandi.",
        "paused": "Bildirishnomalar to‘xtatildi. /resume buyrug‘igacha yangi xabarlar o‘tkazib yuboriladi.",
        "resumed": "Bildirishnomalar yana yoqildi.",
        "connected": "Telegram bildirishnomalari ulangan va faol.",
        "disconnected": "Telegram bildirishnomalari uzildi.",
        "invalid": "Ulanish havolasi yaroqsiz yoki muddati tugagan. GTS Tasks System ichida yangi havola yarating.",
        "inactive": "GTS Tasks System hisobingiz bloklangan yoki faol emas.",
        "help": "Buyruqlar: /tasks, /status, /pause, /resume, /settings, /disconnect",
        "settings": "GTS Tasks System bildirishnoma sozlamalarini oching.",
        "open_settings": "Sozlamalarni ochish",
        "tasks": "Sizga mavjud GTS Tasks System vazifalarini oching.",
        "open_tasks": "Vazifalar",
        "test": "GTS Tasks System: Telegram ulanishi muvaffaqiyatli tekshirildi.",
    },
}


def _strings(user=None, telegram_language=None):
    language = getattr(getattr(user, "profile", None), "language", "en") if user else telegram_language or "en"
    language = str(language).lower().replace("_", "-").split("-", 1)[0]
    return COMMAND_TEXT.get(language, COMMAND_TEXT["en"])


def _send_command_message(chat_id, text, button=None):
    payload = {"chat_id": chat_id, "text": text}
    if button:
        payload["reply_markup"] = {"inline_keyboard": [[button]]}
    from plane.bgtasks.telegram_notification_task import send_telegram_command_message

    send_telegram_command_message.delay(payload)


def _mini_app_button(strings):
    return {
        "text": strings["open_tasks"],
        "web_app": {"url": application_url("telegram-app/")},
    }


def _available_workspaces(user):
    return Workspace.objects.filter(
        workspace_member__member=user,
        workspace_member__is_active=True,
    ).distinct()


class TelegramMiniAppSessionEndpoint(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        configuration = telegram_configuration()
        if not configuration["enabled"] or not configuration["token"] or not configuration["bot_id"]:
            return Response(
                {"error": "Telegram Mini App is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            validated_data = validate_telegram_web_app_init_data(request.data.get("init_data", ""))
        except TelegramWebAppDataError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        connection = (
            TelegramUserConnection.objects.select_related("user", "user__profile")
            .filter(
                telegram_user_id=validated_data["telegram_user_id"],
                bot_id=int(configuration["bot_id"]),
            )
            .first()
        )
        if not connection:
            return Response(
                {"error": "Connect this Telegram account in GTS Tasks System first."},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = connection.user
        if not user.is_active or user.blocked_at is not None:
            return Response({"error": _strings(user)["inactive"]}, status=status.HTTP_403_FORBIDDEN)

        workspaces = list(_available_workspaces(user).values("id", "name", "slug"))
        if not workspaces:
            return Response(
                {"error": "No available workspaces were found."},
                status=status.HTTP_403_FORBIDDEN,
            )
        preferred_workspace_id = getattr(user.profile, "last_workspace_id", None)
        preferred_workspace = next(
            (workspace for workspace in workspaces if str(workspace["id"]) == str(preferred_workspace_id)),
            workspaces[0],
        )

        user_login(request=request, user=user, is_app=True)
        request.session["telegram_mini_app_user_id"] = str(user.id)
        request.session["telegram_mini_app_authenticated_at"] = timezone.now().isoformat()
        request.session.save()
        csrf_token = get_token(request)
        return Response(
            {
                "csrf_token": csrf_token,
                "workspace_slug": preferred_workspace["slug"],
                "workspaces": workspaces,
            }
        )


class TelegramMiniAppAccessEndpoint(BaseAPIView):
    def get(self, request):
        session_user_id = request.session.get("telegram_mini_app_user_id")
        configuration = telegram_configuration()
        if not configuration["enabled"] or not configuration["bot_id"]:
            return Response(
                {"error": "Telegram Mini App is not configured."},
                status=status.HTTP_403_FORBIDDEN,
            )
        connection_exists = TelegramUserConnection.objects.filter(
            user=request.user,
            telegram_user_id__isnull=False,
            bot_id=configuration["bot_id"],
        ).exists()
        if str(request.user.id) != str(session_user_id) or not connection_exists:
            return Response(
                {"error": "Telegram Mini App session is not available."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(
            {
                "allowed": True,
                "workspaces": list(_available_workspaces(request.user).values("id", "name", "slug")),
            }
        )


class TelegramNotificationPreferenceEndpoint(BaseAPIView):
    def get(self, request):
        configuration = telegram_configuration()
        preference = preference_for(request.user)
        connection = TelegramUserConnection.objects.filter(user=request.user).first()
        return Response(
            {
                "configured": configuration["enabled"] and bool(configuration["token"]),
                "bot_username": configuration["bot_username"],
                "connection": (
                    {
                        "status": connection.status,
                        "telegram_username": connection.telegram_username,
                        "telegram_first_name": connection.telegram_first_name,
                        "connected_at": connection.connected_at,
                        "last_delivery_at": connection.last_delivery_at,
                        "last_error": connection.last_error,
                    }
                    if connection
                    else None
                ),
                "preferences": TelegramNotificationPreferenceSerializer(preference).data,
                "timezone": request.user.user_timezone,
            }
        )

    def patch(self, request):
        preference = preference_for(request.user)
        serializer = TelegramNotificationPreferenceSerializer(preference, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TelegramLinkEndpoint(BaseAPIView):
    def post(self, request):
        configuration = telegram_configuration()
        if not configuration["enabled"] or not configuration["token"] or not configuration["bot_username"]:
            return Response(
                {"error": "Telegram bot is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        expires_at = timezone.now() + timedelta(minutes=15)
        TelegramLinkToken.objects.filter(user=request.user, used_at__isnull=True).delete()
        TelegramLinkToken.objects.create(user=request.user, token_hash=token_hash, expires_at=expires_at)
        return Response(
            {
                "url": f"https://t.me/{configuration['bot_username']}?start={raw_token}",
                "expires_at": expires_at,
            },
            status=status.HTTP_201_CREATED,
        )


class TelegramDisconnectEndpoint(BaseAPIView):
    def delete(self, request):
        connection = TelegramUserConnection.objects.filter(user=request.user).first()
        if connection:
            TelegramDelivery.objects.filter(
                connection=connection,
                status__in=[TelegramDelivery.Status.PENDING, TelegramDelivery.Status.PROCESSING],
            ).update(status=TelegramDelivery.Status.CANCELLED)
            connection.delete()
        TelegramLinkToken.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TelegramWebhookEndpoint(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        configuration = telegram_configuration()
        supplied_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if (
            not configuration["enabled"]
            or not configuration["webhook_secret"]
            or not secrets.compare_digest(supplied_secret, configuration["webhook_secret"])
        ):
            return Response(status=status.HTTP_403_FORBIDDEN)
        message = request.data.get("message") or {}
        chat = message.get("chat") or {}
        sender = message.get("from") or {}
        if chat.get("type") != "private" or not message.get("text"):
            return Response({"ok": True})
        chat_id = chat.get("id")
        telegram_user_id = sender.get("id")
        fallback_strings = _strings(telegram_language=sender.get("language_code"))
        command_parts = message.get("text", "").strip().split(maxsplit=1)
        command = command_parts[0].split("@", 1)[0].lower()
        argument = command_parts[1].strip() if len(command_parts) > 1 else ""

        if command == "/start":
            self._connect(argument, chat_id, telegram_user_id, sender, configuration)
            return Response({"ok": True})

        connection = (
            TelegramUserConnection.objects.select_related("user", "user__profile")
            .filter(chat_id=chat_id, telegram_user_id=telegram_user_id)
            .first()
        )
        if not connection:
            _send_command_message(chat_id, fallback_strings["invalid"])
            return Response({"ok": True})
        strings = _strings(connection.user)
        if not connection.user.is_active or connection.user.blocked_at is not None:
            _send_command_message(chat_id, strings["inactive"])
            return Response({"ok": True})
        if command == "/tasks":
            _send_command_message(chat_id, strings["tasks"], _mini_app_button(strings))
        elif command == "/pause":
            connection.status = TelegramUserConnection.Status.PAUSED
            connection.last_error = ""
            connection.save(update_fields=["status", "last_error", "updated_at"])
            _send_command_message(chat_id, strings["paused"])
        elif command == "/resume":
            connection.status = TelegramUserConnection.Status.CONNECTED
            connection.last_error = ""
            connection.save(update_fields=["status", "last_error", "updated_at"])
            _send_command_message(chat_id, strings["resumed"])
        elif command == "/status":
            key = "paused" if connection.status == TelegramUserConnection.Status.PAUSED else "connected"
            _send_command_message(chat_id, strings[key])
        elif command == "/settings":
            _send_command_message(
                chat_id,
                strings["settings"],
                {"text": strings["open_settings"], "url": application_url("settings/profile/notifications/")},
            )
        elif command == "/disconnect":
            TelegramDelivery.objects.filter(
                connection=connection,
                status__in=[TelegramDelivery.Status.PENDING, TelegramDelivery.Status.PROCESSING],
            ).update(status=TelegramDelivery.Status.CANCELLED)
            connection.delete()
            _send_command_message(chat_id, strings["disconnected"])
        else:
            _send_command_message(chat_id, strings["help"])
        return Response({"ok": True})

    def _connect(self, raw_token, chat_id, telegram_user_id, sender, configuration):
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest() if raw_token else ""
        with transaction.atomic():
            link = (
                TelegramLinkToken.objects.select_for_update(of=("self",))
                .select_related("user", "user__profile")
                .filter(token_hash=token_hash, used_at__isnull=True, expires_at__gt=timezone.now())
                .first()
            )
            if not link:
                _send_command_message(
                    chat_id,
                    _strings(telegram_language=sender.get("language_code"))["invalid"],
                )
                return
            user = link.user
            strings = _strings(user)
            if not user.is_active or user.blocked_at is not None:
                _send_command_message(chat_id, strings["inactive"])
                return
            TelegramUserConnection.objects.filter(user=user).delete()
            TelegramUserConnection.objects.filter(chat_id=chat_id).delete()
            TelegramUserConnection.objects.create(
                user=user,
                telegram_user_id=telegram_user_id,
                chat_id=chat_id,
                telegram_username=sender.get("username", ""),
                telegram_first_name=sender.get("first_name", ""),
                bot_id=int(configuration["bot_id"]),
                status=TelegramUserConnection.Status.CONNECTED,
            )
            preference_for(user)
            link.used_at = timezone.now()
            link.save(update_fields=["used_at", "updated_at"])
        _send_command_message(
            chat_id,
            strings["welcome"],
            _mini_app_button(strings),
        )
