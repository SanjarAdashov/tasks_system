# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models

from .project import ProjectBaseModel


class ProjectAnnouncement(ProjectBaseModel):
    class AnnouncementType(models.TextChoices):
        STANDARD = "standard", "Standard"
        IMPORTANT = "important", "Important"

    title = models.CharField(max_length=255)
    content_html = models.TextField()
    content_plain = models.TextField()
    announcement_type = models.CharField(
        max_length=16,
        choices=AnnouncementType.choices,
        default=AnnouncementType.STANDARD,
    )
    recipient_selection = models.JSONField(default=dict)
    recipient_count = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "project_announcements"
        ordering = ("-sent_at", "-created_at")
        indexes = [
            models.Index(fields=["project", "sent_at"], name="project_announcement_sent_idx"),
        ]


class ProjectAnnouncementRecipient(ProjectBaseModel):
    class DeliveryStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        SKIPPED = "skipped", "Skipped"
        FAILED = "failed", "Failed"

    announcement = models.ForeignKey(
        ProjectAnnouncement,
        on_delete=models.CASCADE,
        related_name="recipients",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_announcement_recipients",
    )
    notification = models.OneToOneField(
        "db.Notification",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_announcement_recipient",
    )
    read_at = models.DateTimeField(null=True, blank=True)
    modal_dismissed_at = models.DateTimeField(null=True, blank=True)
    modal_dismiss_count = models.PositiveIntegerField(default=0)
    email_status = models.CharField(
        max_length=16,
        choices=DeliveryStatus.choices,
        default=DeliveryStatus.PENDING,
    )
    telegram_status = models.CharField(
        max_length=16,
        choices=DeliveryStatus.choices,
        default=DeliveryStatus.PENDING,
    )
    email_error = models.TextField(blank=True, default="")
    telegram_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "project_announcement_recipients"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["announcement", "user"],
                name="unique_project_announcement_recipient",
            )
        ]
        indexes = [
            models.Index(fields=["user", "read_at"], name="ann_recipient_read_idx"),
            models.Index(fields=["announcement", "read_at"], name="ann_read_stats_idx"),
        ]


class ProjectAnnouncementAttachment(ProjectBaseModel):
    announcement = models.ForeignKey(
        ProjectAnnouncement,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    asset = models.OneToOneField(
        "db.FileAsset",
        on_delete=models.CASCADE,
        related_name="project_announcement_attachment",
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "project_announcement_attachments"
        ordering = ("sort_order", "created_at")
