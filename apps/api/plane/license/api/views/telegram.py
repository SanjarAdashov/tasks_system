# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import secrets
from urllib.parse import urlsplit

from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import TelegramDelivery, TelegramLinkToken, TelegramUserConnection
from plane.utils.telegram import (
    TelegramAPIError,
    api_url,
    clear_telegram_configuration,
    save_telegram_configuration,
    telegram_api_call,
    telegram_configuration,
    user_name,
    validate_telegram_api_endpoint,
    validate_telegram_proxy_url,
)
from plane.app.views.telegram import _strings
from .base import BaseAPIView


def telegram_status_payload(fetch_webhook=True):
    configuration = telegram_configuration()
    custom_api_endpoint = configuration["api_endpoint"]
    parsed_api_endpoint = urlsplit(custom_api_endpoint) if custom_api_endpoint else None
    payload = {
        "configured": bool(configuration["token"]),
        "enabled": configuration["enabled"],
        "bot_id": configuration["bot_id"] or None,
        "bot_username": configuration["bot_username"] or None,
        "webhook_url": api_url("api/telegram/webhook/") if configuration["token"] else None,
        "webhook": None,
        "connection_count": TelegramUserConnection.objects.count(),
        "proxy_configured": bool(configuration["proxy_url"]),
        "proxy_scheme": configuration["proxy_url"].split(":", 1)[0].lower() if configuration["proxy_url"] else None,
        "api_endpoint_mode": "custom" if custom_api_endpoint else "standard",
        "custom_api_endpoint_configured": bool(custom_api_endpoint),
        "api_endpoint_host": (
            f"{parsed_api_endpoint.hostname}:{parsed_api_endpoint.port}"
            if parsed_api_endpoint and parsed_api_endpoint.port
            else parsed_api_endpoint.hostname
            if parsed_api_endpoint
            else "api.telegram.org"
        ),
    }
    if fetch_webhook and configuration["enabled"] and configuration["token"]:
        try:
            webhook = telegram_api_call("getWebhookInfo")
            payload["webhook"] = {
                "url": webhook.get("url"),
                "pending_update_count": webhook.get("pending_update_count", 0),
                "last_error_date": webhook.get("last_error_date"),
                "last_error_message": webhook.get("last_error_message"),
            }
        except TelegramAPIError as exc:
            payload["webhook"] = {"error": str(exc)}
    return payload


class InstanceTelegramEndpoint(BaseAPIView):
    def get(self, request):
        return Response(telegram_status_payload())

    def post(self, request):
        old_configuration = telegram_configuration()
        token = (request.data.get("token") or old_configuration["token"] or "").strip()
        proxy_url = old_configuration["proxy_url"]
        if "proxy_url" in request.data:
            try:
                proxy_url = validate_telegram_proxy_url(request.data.get("proxy_url"))
            except TelegramAPIError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        api_endpoint = old_configuration["api_endpoint"]
        endpoint_mode = request.data.get("api_endpoint_mode")
        if endpoint_mode is not None and endpoint_mode not in {"standard", "custom"}:
            return Response(
                {"error": "Telegram API endpoint mode must be standard or custom."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if endpoint_mode == "standard":
            api_endpoint = ""
        elif endpoint_mode == "custom":
            if "api_endpoint" in request.data:
                try:
                    api_endpoint = validate_telegram_api_endpoint(request.data.get("api_endpoint"))
                except TelegramAPIError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            if not api_endpoint:
                return Response(
                    {"error": "Custom Telegram API endpoint is required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif "api_endpoint" in request.data:
            try:
                api_endpoint = validate_telegram_api_endpoint(request.data.get("api_endpoint"))
            except TelegramAPIError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not token:
            return Response({"error": "Bot token is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            bot = telegram_api_call(
                "getMe",
                token=token,
                proxy_url=proxy_url,
                api_endpoint=api_endpoint,
            )
            if not bot.get("is_bot") or not bot.get("username"):
                raise TelegramAPIError("The token does not belong to a valid Telegram bot")
            webhook_secret = secrets.token_urlsafe(32)
            webhook_url = api_url("api/telegram/webhook/")
            telegram_api_call(
                "setWebhook",
                {
                    "url": webhook_url,
                    "secret_token": webhook_secret,
                    "allowed_updates": ["message"],
                    "drop_pending_updates": True,
                },
                token=token,
                proxy_url=proxy_url,
                api_endpoint=api_endpoint,
            )
        except TelegramAPIError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        bot_changed = bool(old_configuration["bot_id"]) and str(bot["id"]) != str(old_configuration["bot_id"])
        if bot_changed:
            TelegramUserConnection.objects.all().delete()
            TelegramLinkToken.objects.all().delete()
        save_telegram_configuration(
            token=token,
            webhook_secret=webhook_secret,
            bot_id=bot["id"],
            bot_username=bot["username"],
            enabled=request.data.get("enabled", True),
            proxy_url=proxy_url,
            api_endpoint=api_endpoint,
        )
        return Response({**telegram_status_payload(fetch_webhook=False), "connections_invalidated": bot_changed})

    def delete(self, request):
        configuration = telegram_configuration()
        if configuration["token"]:
            try:
                telegram_api_call(
                    "deleteWebhook",
                    {"drop_pending_updates": True},
                    token=configuration["token"],
                )
            except TelegramAPIError:
                pass
        TelegramUserConnection.objects.all().delete()
        TelegramLinkToken.objects.all().delete()
        clear_telegram_configuration()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstanceTelegramTestEndpoint(BaseAPIView):
    def post(self, request):
        connection = TelegramUserConnection.objects.filter(user=request.user).first()
        if not connection:
            return Response(
                {"error": "Connect your Telegram account in profile settings first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            telegram_api_call(
                "sendMessage",
                {
                    "chat_id": connection.chat_id,
                    "text": _strings(request.user)["test"],
                },
            )
        except TelegramAPIError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"message": "Test message sent."})


class InstanceTelegramConnectionEndpoint(BaseAPIView):
    def get(self, request):
        connections = TelegramUserConnection.objects.select_related("user").order_by("-connected_at")
        search = request.query_params.get("search", "").strip()
        if search:
            connections = connections.filter(
                Q(user__email__icontains=search)
                | Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(telegram_username__icontains=search)
            )

        def serialize(items):
            return [
                {
                    "id": str(connection.id),
                    "user_id": str(connection.user_id),
                    "name": user_name(connection.user),
                    "email": connection.user.email,
                    "telegram_username": connection.telegram_username,
                    "telegram_first_name": connection.telegram_first_name,
                    "status": connection.status,
                    "connected_at": connection.connected_at,
                    "last_delivery_at": connection.last_delivery_at,
                    "account_active": connection.user.is_active and connection.user.blocked_at is None,
                }
                for connection in items
            ]

        return self.paginate(
            request=request,
            queryset=connections,
            on_results=serialize,
            max_per_page=100,
            default_per_page=50,
        )


class InstanceTelegramConnectionDisconnectEndpoint(BaseAPIView):
    def delete(self, request, connection_id):
        connection = TelegramUserConnection.objects.filter(pk=connection_id).first()
        if not connection:
            return Response(status=status.HTTP_404_NOT_FOUND)
        TelegramDelivery.objects.filter(
            connection=connection,
            status__in=[TelegramDelivery.Status.PENDING, TelegramDelivery.Status.PROCESSING],
        ).update(status=TelegramDelivery.Status.CANCELLED)
        connection.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
