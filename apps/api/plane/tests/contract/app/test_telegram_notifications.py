# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import uuid
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Notification,
    Meeting,
    Profile,
    Project,
    TelegramDelivery,
    TelegramLinkToken,
    TelegramUserConnection,
    User,
    Workspace,
)
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration
from plane.app.views.project.invite import notify_project_joined
from plane.app.views.workspace.invite import notify_workspace_joined
from plane.utils.telegram import (
    enqueue_telegram_notifications,
    may_deliver,
    preference_for,
    quiet_hours_available_at,
    render_delivery,
    save_telegram_configuration,
    telegram_api_call,
    telegram_configuration,
    telegram_plain_text,
    validate_telegram_api_endpoint,
    validate_telegram_proxy_url,
)


def create_user(label):
    suffix = uuid.uuid4().hex[:8]
    user = User.objects.create(
        email=f"{label}-{suffix}@example.com",
        username=f"{label}-{suffix}",
        first_name=label.title(),
        last_name="User",
    )
    Profile.objects.create(user=user)
    return user


def configure_bot(proxy_url="", api_endpoint=""):
    save_telegram_configuration(
        token="test-token",
        webhook_secret="test-secret",
        bot_id=12345,
        bot_username="gts_test_bot",
        proxy_url=proxy_url,
        api_endpoint=api_endpoint,
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
            "plane.bgtasks.telegram_notification_task.send_telegram_command_message.delay",
            lambda payload: sent.append(payload),
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
        assert sent[-1]["text"] == "Telegram notifications are connected to GTS Tasks System."

        pause = client.post(
            "/api/telegram/webhook/",
            {"message": {"text": "/pause", "chat": {"id": 777, "type": "private"}, "from": {"id": 888}}},
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="test-secret",
        )
        assert pause.status_code == status.HTTP_200_OK
        connection.refresh_from_db()
        assert connection.status == TelegramUserConnection.Status.PAUSED
        assert sent[-1]["text"].startswith("Notifications are paused")

        status_response = client.post(
            "/api/telegram/webhook/",
            {"message": {"text": "/status", "chat": {"id": 777, "type": "private"}, "from": {"id": 888}}},
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="test-secret",
        )
        assert status_response.status_code == status.HTTP_200_OK
        assert sent[-1]["text"].startswith("Notifications are paused")

    def test_invalid_connection_uses_telegram_language_and_queues_response(self, monkeypatch):
        configure_bot()
        queued = []
        monkeypatch.setattr(
            "plane.bgtasks.telegram_notification_task.send_telegram_command_message.delay",
            lambda payload: queued.append(payload),
        )
        client = APIClient()

        response = client.post(
            "/api/telegram/webhook/",
            {
                "message": {
                    "text": "/status",
                    "chat": {"id": 999, "type": "private"},
                    "from": {"id": 111, "language_code": "ru-RU"},
                }
            },
            format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="test-secret",
        )

        assert response.status_code == status.HTTP_200_OK
        assert queued[-1]["text"].startswith("Ссылка недействительна")

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

    def test_meeting_notification_creates_localized_personal_delivery(self, monkeypatch):
        actor = create_user("meeting-actor")
        receiver = create_user("meeting-receiver")
        receiver.profile.language = "ru"
        receiver.profile.save(update_fields=["language", "updated_at"])
        configure_bot()
        connection = TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=121,
            chat_id=221,
            bot_id=12345,
        )
        workspace = Workspace.objects.create(
            name="Meeting workspace",
            slug=f"meeting-{uuid.uuid4().hex[:8]}",
            owner=actor,
        )
        project = Project.objects.create(
            name="Meeting project",
            identifier="MTG",
            workspace=workspace,
            created_by=actor,
        )
        starts_at = timezone.now() + timezone.timedelta(days=1)
        meeting = Meeting.objects.create(
            workspace=workspace,
            project=project,
            organizer=actor,
            title="Flight readiness review",
            starts_at=starts_at,
            ends_at=starts_at + timezone.timedelta(minutes=45),
            timezone="Asia/Tashkent",
        )
        notification = Notification.objects.create(
            workspace=workspace,
            project=project,
            sender="in_app:calendar:meeting",
            triggered_by=actor,
            receiver=receiver,
            entity_identifier=meeting.id,
            entity_name="meeting",
            title=meeting.title,
            message={"event": "CREATED"},
            data={
                "meeting": {
                    "id": str(meeting.id),
                    "title": meeting.title,
                    "starts_at": meeting.starts_at.isoformat(),
                    "ends_at": meeting.ends_at.isoformat(),
                    "event": "CREATED",
                }
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
        assert delivery.category == "account_activity"
        assert delivery.issue_id is None
        assert delivery.payload["kind"] == "meeting"
        assert delivery.payload["meeting_id"] == str(meeting.id)
        assert delivery.payload["url"].endswith(f"/{workspace.slug}/calendar?meeting={meeting.id}")
        assert may_deliver(delivery) is True
        assert queued == [str(delivery.id)]

        rendered = render_delivery(delivery)
        assert "Приглашение на встречу" in rendered["text"]
        assert meeting.title in rendered["text"]
        assert rendered["reply_markup"]["inline_keyboard"][0][0]["text"] == "Открыть календарь"

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
                "issue_activity": {
                    "field": "comment",
                    "old_value": "None",
                    "new_value": (
                        '<p class="editor-paragraph-block" data-id="block-id">'
                        '<mention-component id="mention-id" entity_identifier="user-id" '
                        'entity_name="user_mention"></mention-component> '
                        "Please review &amp; approve</p>"
                    ),
                },
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
        assert delivery.payload["comment"] == "Please review & approve"
        assert queued == [str(delivery.id)]

        message = render_delivery(delivery)["text"]
        assert "Please review &amp; approve" in message
        assert "editor-paragraph-block" not in message
        assert "mention-component" not in message
        assert "Field:" not in message
        assert "Was:" not in message
        assert "Now:" not in message
        assert "Comment:" not in message

    def test_rendering_localizes_fields_values_dates_attachments_and_system_actor(self):
        receiver = create_user("render-receiver")
        receiver.profile.language = "ru"
        receiver.profile.save(update_fields=["language", "updated_at"])
        connection = TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=555,
            chat_id=666,
            bot_id=12345,
        )

        priority_delivery = TelegramDelivery(
            connection=connection,
            receiver=receiver,
            category="priority",
            payload={
                "kind": "issue",
                "issue_key": "GTS-1944",
                "issue_name": "Update integration",
                "actor_name": "Sanjar Adashov",
                "field": "priority",
                "old_value": "None",
                "new_value": "high",
                "url": "https://tasks.example.com/core/browse/GTS-1944/",
            },
        )
        priority_message = render_delivery(priority_delivery)
        assert "Поле: Приоритет" in priority_message["text"]
        assert "Было: Не указано" in priority_message["text"]
        assert "Стало: Высокий" in priority_message["text"]

        date_delivery = TelegramDelivery(
            connection=connection,
            receiver=receiver,
            category="due_date",
            payload={**priority_delivery.payload, "field": "target_date", "old_value": None, "new_value": "2026-08-20"},
        )
        date_message = render_delivery(date_delivery)["text"]
        assert "Поле: Срок выполнения" in date_message
        assert "Стало: 20.08.2026" in date_message

        attachment_delivery = TelegramDelivery(
            connection=connection,
            receiver=receiver,
            category="property_change",
            payload={
                **priority_delivery.payload,
                "attachment_event": "added",
                "attachment_name": "requirements.pdf",
            },
        )
        attachment_message = render_delivery(attachment_delivery)
        assert "К задаче прикреплён файл" in attachment_message["text"]
        assert "Файл: requirements.pdf" in attachment_message["text"]
        assert attachment_message["reply_markup"]["inline_keyboard"][0][0]["text"] == "Открыть задачу"

        access_delivery = TelegramDelivery(
            connection=connection,
            receiver=receiver,
            category="role_change",
            payload={
                "kind": "system",
                "event": "project_role_changed",
                "localized": {"ru": "Ваша роль изменена."},
                "actor_name": "Sanjar Adashov",
                "url": "https://tasks.example.com/core/projects/project-id/issues/",
            },
        )
        access_message = render_delivery(access_delivery)
        assert "Изменил: Sanjar Adashov" in access_message["text"]
        assert access_message["reply_markup"]["inline_keyboard"][0][0]["text"] == "Открыть проект"

    def test_comment_cleanup_handles_mention_only_and_long_text(self):
        mention_only = (
            '<p><mention-component entity_identifier="user-id" entity_name="user_mention"></mention-component></p>'
        )
        assert telegram_plain_text(mention_only) == ""

        cleaned = telegram_plain_text("A" * 1300)
        assert len(cleaned) == 1200
        assert cleaned.endswith("…")

        receiver = create_user("mention-only")
        receiver.profile.language = "ru"
        receiver.profile.save(update_fields=["language", "updated_at"])
        connection = TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=667,
            chat_id=668,
            bot_id=12345,
        )
        delivery = TelegramDelivery(
            connection=connection,
            receiver=receiver,
            category="mention",
            payload={
                "kind": "issue",
                "issue_key": "GTS-1944",
                "issue_name": "Update integration",
                "actor_name": "Sanjar Adashov",
                "comment": "",
            },
        )
        assert "Вас упомянули без дополнительного сообщения." in render_delivery(delivery)["text"]

    def test_attachment_activity_uses_original_filename_and_task_link(self, monkeypatch):
        actor = create_user("attachment-actor")
        receiver = create_user("attachment-receiver")
        configure_bot()
        TelegramUserConnection.objects.create(
            user=receiver,
            telegram_user_id=777,
            chat_id=888,
            bot_id=12345,
        )
        workspace = Workspace.objects.create(
            name="Attachment workspace",
            slug=f"attachment-{uuid.uuid4().hex[:8]}",
            owner=actor,
        )
        project = Project.objects.create(
            name="Attachment project",
            identifier="ATT",
            workspace=workspace,
            created_by=actor,
        )
        notification = Notification.objects.create(
            workspace=workspace,
            project=project,
            sender="in_app:issue_activities:subscribed",
            triggered_by=actor,
            receiver=receiver,
            entity_identifier=uuid.uuid4(),
            entity_name="issue",
            title="Attachment added",
            data={
                "issue": {"name": "Attachment task", "identifier": "ATT", "sequence_id": 1},
                "issue_activity": {
                    "verb": "created",
                    "field": "attachment",
                    "new_value": f"{workspace.id}/{uuid.uuid4().hex}-requirements.pdf",
                },
            },
        )
        monkeypatch.setattr(
            "plane.bgtasks.telegram_notification_task.deliver_telegram_delivery.delay",
            lambda delivery_id: None,
        )

        delivery = enqueue_telegram_notifications([notification])[0]

        assert delivery.category == "property_change"
        assert delivery.payload["attachment_event"] == "added"
        assert delivery.payload["attachment_name"] == "requirements.pdf"
        assert delivery.payload["url"].endswith(f"/{workspace.slug}/browse/ATT-1/")

    def test_invitation_notifications_include_scope_role_and_correct_button(self, monkeypatch):
        actor = create_user("invite-actor")
        receiver = create_user("invite-receiver")
        workspace = Workspace.objects.create(
            name="Invite workspace",
            slug=f"invite-{uuid.uuid4().hex[:8]}",
            owner=actor,
        )
        project = Project.objects.create(
            name="Invite project",
            identifier="INV",
            workspace=workspace,
            created_by=actor,
        )
        workspace_calls = []
        project_calls = []
        monkeypatch.setattr(
            "plane.app.views.workspace.invite.enqueue_system_telegram_notification",
            lambda **kwargs: workspace_calls.append(kwargs),
        )
        monkeypatch.setattr(
            "plane.app.views.project.invite.enqueue_system_telegram_notification",
            lambda **kwargs: project_calls.append(kwargs),
        )

        notify_workspace_joined(
            SimpleNamespace(workspace=workspace, role=15, created_by=actor),
            receiver,
        )
        notify_project_joined(
            SimpleNamespace(project=project, role=20, created_by=actor),
            receiver,
        )

        assert workspace_calls[0]["event"] == "workspace_membership_added"
        assert workspace_calls[0]["context"]["button_key"] == "open_workspace"
        assert "Роль: Участник" in workspace_calls[0]["context"]["localized"]["ru"]
        assert project_calls[0]["event"] == "project_membership_added"
        assert project_calls[0]["context"]["button_key"] == "open_project"
        assert "Роль: Администратор проекта" in project_calls[0]["context"]["localized"]["ru"]

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
        configure_bot(
            proxy_url="socks5h://proxy-user:proxy-password@proxy.example.com:1080",
            api_endpoint="https://telegram-proxy.example.com/api",
        )
        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.get("/api/instances/configurations/")
        assert response.status_code == status.HTTP_200_OK
        keys = {item["key"] for item in response.data}
        assert "TELEGRAM_BOT_TOKEN" not in keys
        assert "TELEGRAM_WEBHOOK_SECRET" not in keys
        assert "TELEGRAM_PROXY_URL" not in keys
        assert "TELEGRAM_API_ENDPOINT" not in keys

    def test_proxy_url_validation(self):
        assert (
            validate_telegram_proxy_url("socks5h://user:password@proxy.example.com:1080")
            == "socks5h://user:password@proxy.example.com:1080"
        )
        with pytest.raises(Exception, match="must use http, https, socks5, or socks5h"):
            validate_telegram_proxy_url("ftp://proxy.example.com:21")
        with pytest.raises(Exception, match="must include a host and port"):
            validate_telegram_proxy_url("https://proxy.example.com")

    def test_custom_api_endpoint_validation(self):
        assert (
            validate_telegram_api_endpoint("https://telegram-proxy.example.com/gateway/")
            == "https://telegram-proxy.example.com/gateway"
        )
        with pytest.raises(Exception, match="must use HTTPS"):
            validate_telegram_api_endpoint("http://telegram-proxy.example.com")
        with pytest.raises(Exception, match="must include a host"):
            validate_telegram_api_endpoint("https:///gateway")
        with pytest.raises(Exception, match="cannot include a query or fragment"):
            validate_telegram_api_endpoint("https://telegram-proxy.example.com?secret=value")

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

        result = telegram_api_call(
            "getMe",
            token="test-token",
            proxy_url="",
            api_endpoint="https://telegram-proxy.example.com/gateway/",
        )
        assert result == {"id": 12345}
        assert captured["proxies"] is None
        assert captured["url"] == "https://telegram-proxy.example.com/gateway/bottest-token/getMe"

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

    def test_instance_admin_configures_encrypted_custom_api_endpoint_and_can_restore_standard(self, monkeypatch):
        admin = create_user("endpoint-admin")
        instance = Instance.objects.create(
            instance_name="Telegram endpoint test",
            instance_id=uuid.uuid4().hex,
            current_version="1.4.0",
            last_checked_at=timezone.now(),
        )
        InstanceAdmin.objects.create(instance=instance, user=admin)
        calls = []

        def fake_telegram_call(method, payload=None, **kwargs):
            calls.append((method, kwargs.get("api_endpoint")))
            if method == "getMe":
                return {"id": 65432, "is_bot": True, "username": "endpoint_bot"}
            return True

        monkeypatch.setattr("plane.license.api.views.telegram.telegram_api_call", fake_telegram_call)
        client = APIClient()
        client.force_authenticate(user=admin)
        api_endpoint = "https://telegram-proxy.example.com/gateway"

        response = client.post(
            "/api/instances/telegram/",
            {
                "token": "endpoint-test-token",
                "api_endpoint_mode": "custom",
                "api_endpoint": api_endpoint,
                "enabled": True,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["api_endpoint_mode"] == "custom"
        assert response.data["custom_api_endpoint_configured"] is True
        assert response.data["api_endpoint_host"] == "telegram-proxy.example.com"
        assert "api_endpoint" not in response.data
        assert calls == [("getMe", api_endpoint), ("setWebhook", api_endpoint)]
        stored = InstanceConfiguration.objects.get(key="TELEGRAM_API_ENDPOINT")
        assert stored.is_encrypted is True
        assert stored.value != api_endpoint
        assert telegram_configuration()["api_endpoint"] == api_endpoint

        calls.clear()
        response = client.post(
            "/api/instances/telegram/",
            {"api_endpoint_mode": "standard", "enabled": True},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["api_endpoint_mode"] == "standard"
        assert response.data["custom_api_endpoint_configured"] is False
        assert response.data["api_endpoint_host"] == "api.telegram.org"
        assert calls == [("getMe", ""), ("setWebhook", "")]
        assert not InstanceConfiguration.objects.filter(key="TELEGRAM_API_ENDPOINT").exists()
