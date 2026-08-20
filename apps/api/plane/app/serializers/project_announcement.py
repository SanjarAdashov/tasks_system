# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import (
    ProjectAnnouncement,
    ProjectAnnouncementAttachment,
    ProjectAnnouncementRecipient,
)

from .base import BaseSerializer
from .user import UserLiteSerializer


class ProjectAnnouncementAttachmentSerializer(BaseSerializer):
    name = serializers.CharField(source="asset.attributes.name", read_only=True)
    content_type = serializers.CharField(source="asset.attributes.type", read_only=True)
    size = serializers.FloatField(source="asset.size", read_only=True)
    download_url = serializers.SerializerMethodField()
    inline_url = serializers.SerializerMethodField()

    class Meta:
        model = ProjectAnnouncementAttachment
        fields = [
            "id",
            "name",
            "content_type",
            "size",
            "download_url",
            "inline_url",
            "created_at",
        ]

    def _url(self, obj, disposition):
        return (
            f"/api/workspaces/{obj.workspace.slug}/project-announcements/"
            f"{obj.announcement_id}/attachments/{obj.id}/?disposition={disposition}"
        )

    def get_download_url(self, obj):
        return self._url(obj, "attachment")

    def get_inline_url(self, obj):
        return self._url(obj, "inline")


class ProjectAnnouncementRecipientSerializer(BaseSerializer):
    user_details = UserLiteSerializer(source="user", read_only=True)

    class Meta:
        model = ProjectAnnouncementRecipient
        fields = [
            "id",
            "user",
            "user_details",
            "read_at",
            "modal_dismissed_at",
            "modal_dismiss_count",
            "email_status",
            "telegram_status",
            "email_error",
            "telegram_error",
            "created_at",
        ]


class ProjectAnnouncementSerializer(BaseSerializer):
    attachments = ProjectAnnouncementAttachmentSerializer(many=True, read_only=True)
    created_by_details = UserLiteSerializer(source="created_by", read_only=True)
    statistics = serializers.SerializerMethodField()

    class Meta:
        model = ProjectAnnouncement
        fields = [
            "id",
            "project",
            "workspace",
            "title",
            "content_html",
            "content_plain",
            "announcement_type",
            "recipient_selection",
            "recipient_count",
            "sent_at",
            "created_by",
            "created_by_details",
            "attachments",
            "statistics",
        ]
        read_only_fields = fields

    def get_statistics(self, obj):
        if not self.context.get("include_statistics"):
            return None
        recipients = obj.recipients.all()
        return {
            "total": obj.recipient_count,
            "read": sum(1 for recipient in recipients if recipient.read_at),
            "unread": sum(1 for recipient in recipients if not recipient.read_at),
            "modal_dismissals": sum(recipient.modal_dismiss_count for recipient in recipients),
            "email": {
                status: sum(1 for recipient in recipients if recipient.email_status == status)
                for status, _ in ProjectAnnouncementRecipient.DeliveryStatus.choices
            },
            "telegram": {
                status: sum(1 for recipient in recipients if recipient.telegram_status == status)
                for status, _ in ProjectAnnouncementRecipient.DeliveryStatus.choices
            },
        }


class ProjectAnnouncementDetailSerializer(ProjectAnnouncementSerializer):
    recipient_state = serializers.SerializerMethodField()

    class Meta(ProjectAnnouncementSerializer.Meta):
        fields = ProjectAnnouncementSerializer.Meta.fields + ["recipient_state"]

    def get_recipient_state(self, obj):
        recipient = self.context.get("recipient")
        if not recipient:
            return None
        return {
            "read_at": recipient.read_at,
            "modal_dismissed_at": recipient.modal_dismissed_at,
            "modal_dismiss_count": recipient.modal_dismiss_count,
            "notification_id": recipient.notification_id,
        }
