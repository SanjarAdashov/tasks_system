# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Notification,
    Project,
    TelegramDelivery,
    TelegramLinkToken,
    TelegramUserConnection,
    User,
    Workspace,
)
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration
from plane.utils.telegram import (
    enqueue_telegram_notifications,
    preference_for,
    quiet_hours_available_at,
    save_telegram_configuration,
    telegram_api_call,
    telegram_configuration,
    validate_telegram_proxy_url,
)


def create_user(label):
    suffix = uuid.uuid4().hex[:8]
    return User.objects.create(
        email=f"{label}-{suffix}@example.com",
        username=f"{label}-{suffix}",
        first_name=label.title(),
        last_name="User",
    )


def configure_bot(proxy_url=""):
    save_telegram_configuration(
        token="test-token",
        webhook_secret="test-secret",
        bot_id=12345,
        bot_username="gts_test_bot",
        proxy_url=proxy_url,
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestTelegramNotifications:
    def test_preferences_and_one_time_deep_link(self):
        user = create_user("telegram")
        configure_bot()
        client = APIClient()
        client.force_authenticate(user=user)

        settings_response = client.get("/api/users/me/telegram/")
        assert settings_response.status_code == status.HTTP_200_OK
        assert settings_response.data["configured"] is True
        assert settings_response.data["preferences"]["comment"] is True

        patch_response = client.patch(
            "/api/users/me/telegram/",
            {"comment": False, "quiet_hours_enabled": True},
            format="json",
        )
        assert patch_response.status_code == status.HTTP_200_OK
        assert patch_response.data["comment"] is False

        link_response = client.post("/api/users/me/telegram/link/", {}, format="json")
        assert link_response.status_code == status.HTTP_201_CREATED
        assert link_response.data["url"].startswith("https://t.me/gts_test_bot?start=")
        assert TelegramLinkToken.objects.filter(user=user, used_at__isnull=True).count() == 1

    def test_webhook_links_and_controls_private_chat(self, monkeypatch):
        user = create_user("linked")
        configure_bot()
        raw_token = "one-time-link"
        TelegramLinkToken.objects.create(
            user=user,
            token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            expires_at=timezone.now() + timezone.timedelta(minutes=15),
        )
        sent = []
        monkeypatch.setattr(
            "plane.app.views.telegram.telegram_api_call", lambda method, payload: sent.append((method, payload)) or {}
        )
        client = APIClient()

        response = client.post(
            "/api/telegram/webhook/",
            {
                "message": {
                    "text": f"/start {raw_token}",
                    "chat": {"id": 777, "type": "private"},
                    "from": {"id": 888, "username": "tester", "first_name": "Test"},
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="test-secret",
        )
        assert response.status_code == status.HTTP_200_OK
        connection = TelegramUserConnection.objects.get(user=user)
        assert connection.chat_id == 777
        assert sent[-1][0] == "sendMessage"

        pause = client.post(
            "/api/telegram/webhook/",
            {"message": {"text": "/pause", "chat": {"id": 777, "type": "private"}, "from": {"id": 888}}},
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="test-secret",
        )
        assert pause.status_code == status.HTTP_200_OK
        connection.refresh_from_db()
        assert connection.status == TelegramUserConnection.Status.PAUSED

    def test_task_notification_creates_personal_delivery(self, monkeypatch):
        actor = create_user("actor")
        receiver = create_user("receiver")
        configure_bot()
        connection = TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=111,
            chat_id=222,
            bot_id=12345,
        )
        workspace = Workspace.objects.create(name="Telegram", slug=f"telegram-{uuid.uuid4().hex[:8]}", owner=actor)
        project = Project.objects.create(
            name="Telegram project", identifier="TGN", workspace=workspace, created_by=actor
        )
        notification = Notification.objects.create(
            workspace=workspace,
            project=project,
            sender="in_app:issue_activities:subscribed",
            triggered_by=actor,
            receiver=receiver,
            entity_identifier=uuid.uuid4(),
            entity_name="issue",
            title="Priority changed",
            data={
                "issue": {"name": "Test task", "identifier": "TGN", "sequence_id": 1},
                "issue_activity": {"field": "priority", "old_value": "low", "new_value": "high"},
            },
        )
        queued = []
        monkeypatch.setattr(
            "plane.bgtasks.telegram_notification_task.deliver_telegram_delivery.delay",
            lambda delivery_id: queued.append(delivery_id),
        )

        deliveries = enqueue_telegram_notifications([notification])
        assert len(deliveries) == 1
        delivery = TelegramDelivery.objects.get(connection=connection)
        assert delivery.category == "priority"
        assert delivery.payload["issue_key"] == "TGN-1"
        assert queued == [str(delivery.id)]

    def test_bulk_created_mention_with_string_receiver_id_creates_delivery(self, monkeypatch):
        actor = create_user("mention-actor")
        receiver = create_user("mention-receiver")
        configure_bot()
        connection = TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=333,
            chat_id=444,
            bot_id=12345,
        )
        workspace = Workspace.objects.create(
            name="Telegram mention",
            slug=f"telegram-mention-{uuid.uuid4().hex[:8]}",
            owner=actor,
        )
        project = Project.objects.create(
            name="Telegram mention project",
            identifier="TMN",
            workspace=workspace,
            created_by=actor,
        )
        notification = Notification(
            workspace=workspace,
            project=project,
            sender="in_app:issue_activities:mentioned",
            triggered_by=actor,
            receiver_id=str(receiver.id),
            entity_identifier=uuid.uuid4(),
            entity_name="issue",
            title="Mentioned in a comment",
            data={
                "issue": {"name": "Mention task", "identifier": "TMN", "sequence_id": 1},
                "issue_activity": {"field": "comment", "issue_comment": "Please review"},
            },
        )
        Notification.objects.bulk_create([notification])
        assert isinstance(notification.receiver_id, str)

        queued = []
        monkeypatch.setattr(
            "plane.bgtasks.telegram_notification_task.deliver_telegram_delivery.delay",
            lambda delivery_id: queued.append(delivery_id),
        )

        deliveries = enqueue_telegram_notifications([notification])

        assert len(deliveries) == 1
        delivery = TelegramDelivery.objects.get(connection=connection)
        assert delivery.receiver_id == receiver.id
        assert delivery.category == "mention"
        assert queued == [str(delivery.id)]

    def test_quiet_hours_handles_cross_midnight_in_user_timezone(self):
        user = create_user("quiet")
        user.user_timezone = "Asia/Tashkent"
        user.save(update_fields=["user_timezone", "updated_at"])
        preference = preference_for(user)
        preference.quiet_hours_enabled = True
        preference.quiet_hours = {
            str(day): {"enabled": day == 1, "start": "22:00", "end": "08:00"} for day in range(1, 8)
        }
        local_now = datetime(2026, 8, 17, 23, 30, tzinfo=ZoneInfo("Asia/Tashkent"))
        available_at = quiet_hours_available_at(user, preference, local_now.astimezone(ZoneInfo("UTC")))
        assert available_at.astimezone(ZoneInfo("Asia/Tashkent")) == datetime(
            2026, 8, 18, 8, 0, tzinfo=ZoneInfo("Asia/Tashkent")
        )

    def test_bot_secrets_are_not_returned_by_generic_instance_configuration_endpoint(self):
        admin = create_user("admin")
        instance = Instance.objects.create(
            instance_name="Telegram test",
            instance_id=uuid.uuid4().hex,
            current_version="1.4.0",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=admin)
        configure_bot(proxy_url="socks5h://proxy-user:proxy-password@proxy.example.com:1080")
        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.get("/api/instances/configurations/")
        assert response.status_code == status.HTTP_200_OK
        keys = {item["key"] for item in response.data}
        assert "TELEGRAM_BOT_TOKEN" not in keys
        assert "TELEGRAM_WEBHOOK_SECRET" not in keys
        assert "TELEGRAM_PROXY_URL" not in keys

    def test_proxy_url_validation(self):
        assert (
            validate_telegram_proxy_url("socks5h://user:password@proxy.example.com:1080")
            == "socks5h://user:password@proxy.example.com:1080"
        )
        with pytest.raises(Exception, match="must use http, https, socks5, or socks5h"):
            validate_telegram_proxy_url("ftp://proxy.example.com:21")
        with pytest.raises(Exception, match="must include a host and port"):
            validate_telegram_proxy_url("https://proxy.example.com")

    def test_telegram_api_call_uses_only_the_dedicated_proxy(self, monkeypatch):
        captured = {}

        class Response:
            ok = True
            status_code = 200

            @staticmethod
            def json():
                return {"ok": True, "result": {"id": 12345}}

        def fake_post(url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return Response()

        monkeypatch.setattr("plane.utils.telegram.requests.post", fake_post)
        proxy_url = "socks5h://proxy-user:proxy-password@proxy.example.com:1080"
        result = telegram_api_call("getMe", token="test-token", proxy_url=proxy_url)

        assert result == {"id": 12345}
        assert captured["proxies"] == {"http": proxy_url, "https": proxy_url}
        assert captured["url"].startswith("https://api.telegram.org/bot")

    def test_instance_admin_configures_encrypted_proxy_without_returning_it(self, monkeypatch):
        admin = create_user("proxy-admin")
        instance = Instance.objects.create(
            instance_name="Telegram proxy test",
            instance_id=uuid.uuid4().hex,
            current_version="1.4.0",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=admin)
        calls = []

        def fake_telegram_call(method, payload=None, **kwargs):
            calls.append((method, kwargs.get("proxy_url")))
            if method == "getMe":
                return {"id": 54321, "is_bot": True, "username": "proxy_bot"}
            return True

        monkeypatch.setattr("plane.license.api.views.telegram.telegram_api_call", fake_telegram_call)
        client = APIClient()
        client.force_authenticate(user=admin)
        proxy_url = "https://proxy-user:proxy-password@proxy.example.com:8443"

        response = client.post(
            "/api/instances/telegram/",
            {"token": "proxy-test-token", "proxy_url": proxy_url, "enabled": True},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["proxy_configured"] is True
        assert response.data["proxy_scheme"] == "https"
        assert "proxy_url" not in response.data
        assert calls == [("getMe", proxy_url), ("setWebhook", proxy_url)]
        stored = InstanceConfiguration.objects.get(key="TELEGRAM_PROXY_URL")
        assert stored.is_encrypted is True
        assert stored.value != proxy_url
        assert telegram_configuration()["proxy_url"] == proxy_url
