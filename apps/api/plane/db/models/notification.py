# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.utils import timezone

# Module imports
from .base import BaseModel


class Notification(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="notifications", on_delete=models.CASCADE)
    project = models.ForeignKey("db.Project", related_name="notifications", on_delete=models.CASCADE, null=True)
    data = models.JSONField(null=True)
    entity_identifier = models.UUIDField(null=True)
    entity_name = models.CharField(max_length=255)
    title = models.TextField()
    message = models.JSONField(null=True)
    message_html = models.TextField(blank=True, default="<p></p>")
    message_stripped = models.TextField(blank=True, null=True)
    sender = models.CharField(max_length=255)
    triggered_by = models.ForeignKey(
        "db.User",
        related_name="triggered_notifications",
        on_delete=models.SET_NULL,
        null=True,
    )
    receiver = models.ForeignKey("db.User", related_name="received_notifications", on_delete=models.CASCADE)
    read_at = models.DateTimeField(null=True)
    snoozed_till = models.DateTimeField(null=True)
    archived_at = models.DateTimeField(null=True)

    class Meta:
        verbose_name = "Notification"
        verbose_name_plural = "Notifications"
        db_table = "notifications"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["entity_identifier"], name="notif_entity_identifier_idx"),
            models.Index(fields=["entity_name"], name="notif_entity_name_idx"),
            models.Index(fields=["read_at"], name="notif_read_at_idx"),
            models.Index(fields=["receiver", "read_at"], name="notif_entity_idx"),
            models.Index(
                fields=["receiver", "workspace", "read_at", "created_at"],
                name="notif_receiver_status_idx",
            ),
            models.Index(
                fields=["receiver", "workspace", "entity_name", "read_at"],
                name="notif_receiver_entity_idx",
            ),
            models.Index(
                fields=["receiver", "workspace", "snoozed_till", "archived_at"],
                name="notif_receiver_state_idx",
            ),
            models.Index(
                fields=["receiver", "workspace", "sender"],
                name="notif_receiver_sender_idx",
            ),
            models.Index(
                fields=["workspace", "entity_identifier", "entity_name"],
                name="notif_entity_lookup_idx",
            ),
        ]

    def __str__(self):
        """Return name of the notifications"""
        return f"{self.receiver.email} <{self.workspace.name}>"


def get_default_preference():
    return {
        "property_change": {"email": True},
        "state": {"email": True},
        "comment": {"email": True},
        "mentions": {"email": True},
    }


class UserNotificationPreference(BaseModel):
    # user it is related to
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
    )
    # workspace if it is applicable
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="workspace_notification_preferences",
        null=True,
    )
    # project
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="project_notification_preferences",
        null=True,
    )

    # preference fields
    property_change = models.BooleanField(default=True)
    state_change = models.BooleanField(default=True)
    comment = models.BooleanField(default=True)
    mention = models.BooleanField(default=True)
    issue_completed = models.BooleanField(default=True)

    class Meta:
        verbose_name = "UserNotificationPreference"
        verbose_name_plural = "UserNotificationPreferences"
        db_table = "user_notification_preferences"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the user"""
        return f"<{self.user}>"


class EmailNotificationLog(BaseModel):
    # receiver
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_notifications",
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="triggered_emails",
    )
    # entity - can be issues, pages, etc.
    entity_identifier = models.UUIDField(null=True)
    entity_name = models.CharField(max_length=255)
    # data
    data = models.JSONField(null=True)
    # sent at
    processed_at = models.DateTimeField(null=True)
    sent_at = models.DateTimeField(null=True)
    entity = models.CharField(max_length=200)
    old_value = models.CharField(max_length=300, blank=True, null=True)
    new_value = models.CharField(max_length=300, blank=True, null=True)

    class Meta:
        verbose_name = "Email Notification Log"
        verbose_name_plural = "Email Notification Logs"
        db_table = "email_notification_logs"
        ordering = ("-created_at",)


def get_default_telegram_quiet_hours():
    """Return an independent quiet-hours entry for every ISO weekday."""
    return {str(day): {"enabled": False, "start": "22:00", "end": "08:00"} for day in range(1, 8)}


class TelegramUserConnection(BaseModel):
    class Status(models.TextChoices):
        CONNECTED = "connected", "Connected"
        PAUSED = "paused", "Paused"
        ERROR = "error", "Error"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="telegram_connection",
    )
    telegram_user_id = models.BigIntegerField(unique=True)
    chat_id = models.BigIntegerField(unique=True)
    telegram_username = models.CharField(max_length=255, blank=True, default="")
    telegram_first_name = models.CharField(max_length=255, blank=True, default="")
    bot_id = models.BigIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONNECTED)
    connected_at = models.DateTimeField(default=timezone.now)
    last_delivery_at = models.DateTimeField(null=True, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "telegram_user_connections"
        ordering = ("-connected_at",)


class TelegramNotificationPreference(BaseModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="telegram_notification_preference",
    )
    enabled = models.BooleanField(default=True)
    task_assignment = models.BooleanField(default=True)
    mention = models.BooleanField(default=True)
    comment = models.BooleanField(default=True)
    state_change = models.BooleanField(default=True)
    issue_completed = models.BooleanField(default=True)
    priority = models.BooleanField(default=True)
    due_date = models.BooleanField(default=True)
    property_change = models.BooleanField(default=True)
    role_change = models.BooleanField(default=True)
    account_activity = models.BooleanField(default=True)
    quiet_hours_enabled = models.BooleanField(default=False)
    quiet_hours = models.JSONField(default=get_default_telegram_quiet_hours)

    class Meta:
        db_table = "telegram_notification_preferences"


class TelegramLinkToken(BaseModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="telegram_link_tokens",
    )
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "telegram_link_tokens"
        indexes = [models.Index(fields=["token_hash", "expires_at"], name="tg_link_token_exp_idx")]


class TelegramDelivery(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    connection = models.ForeignKey(
        TelegramUserConnection,
        on_delete=models.CASCADE,
        related_name="deliveries",
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="telegram_deliveries",
    )
    notification = models.ForeignKey(
        Notification,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="telegram_deliveries",
    )
    workspace = models.ForeignKey("db.Workspace", on_delete=models.SET_NULL, null=True, blank=True)
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True, blank=True)
    issue_id = models.UUIDField(null=True, blank=True)
    category = models.CharField(max_length=40)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    available_at = models.DateTimeField(default=timezone.now)
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    telegram_message_id = models.BigIntegerField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")
    idempotency_key = models.CharField(max_length=128, unique=True)

    class Meta:
        db_table = "telegram_deliveries"
        ordering = ("created_at",)
        indexes = [
            models.Index(fields=["status", "available_at", "created_at"], name="tg_delivery_due_idx"),
            models.Index(fields=["receiver", "status"], name="tg_delivery_user_idx"),
        ]
