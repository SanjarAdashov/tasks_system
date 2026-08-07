# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models
from django.db.models import Q

from .project import ProjectBaseModel


MEBIBYTE = 1024 * 1024


class AttachmentFileCategory(models.TextChoices):
    IMAGE = "IMAGE", "Images"
    VIDEO = "VIDEO", "Video"
    AUDIO = "AUDIO", "Audio"
    PDF = "PDF", "PDF"
    DOCUMENT = "DOCUMENT", "Documents"
    ARCHIVE = "ARCHIVE", "Archives"
    OTHER = "OTHER", "Other"


class ProjectAttachmentSettings(ProjectBaseModel):
    image_max_size = models.PositiveBigIntegerField(default=20 * MEBIBYTE, null=True, blank=True)
    video_max_size = models.PositiveBigIntegerField(default=500 * MEBIBYTE, null=True, blank=True)
    audio_max_size = models.PositiveBigIntegerField(default=100 * MEBIBYTE, null=True, blank=True)
    pdf_max_size = models.PositiveBigIntegerField(default=50 * MEBIBYTE, null=True, blank=True)
    document_max_size = models.PositiveBigIntegerField(default=50 * MEBIBYTE, null=True, blank=True)
    archive_max_size = models.PositiveBigIntegerField(default=200 * MEBIBYTE, null=True, blank=True)
    other_max_size = models.PositiveBigIntegerField(default=25 * MEBIBYTE, null=True, blank=True)

    class Meta:
        verbose_name = "Project Attachment Settings"
        verbose_name_plural = "Project Attachment Settings"
        db_table = "project_attachment_settings"
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_project_attachment_settings",
            )
        ]
