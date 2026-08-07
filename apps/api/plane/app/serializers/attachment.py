# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import ProjectAttachmentSettings

from .base import BaseSerializer


class ProjectAttachmentSettingsSerializer(BaseSerializer):
    class Meta:
        model = ProjectAttachmentSettings
        fields = [
            "id",
            "project",
            "workspace",
            "image_max_size",
            "video_max_size",
            "audio_max_size",
            "pdf_max_size",
            "document_max_size",
            "archive_max_size",
            "other_max_size",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "workspace",
            "created_at",
            "updated_at",
        ]
