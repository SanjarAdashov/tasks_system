# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import json
import uuid

from django.db import transaction
from django.db.models import F
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from plane.app.permissions import ProjectAdminPermission
from plane.app.serializers import (
    ProjectAnnouncementDetailSerializer,
    ProjectAnnouncementRecipientSerializer,
    ProjectAnnouncementSerializer,
    ProjectUserGroupSerializer,
    UserLiteSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.bgtasks.project_announcement_task import dispatch_project_announcement
from plane.db.models import (
    FileAsset,
    Notification,
    Project,
    ProjectAnnouncement,
    ProjectAnnouncementAttachment,
    ProjectAnnouncementRecipient,
    ProjectMember,
    ProjectUserGroup,
    ProjectUserGroupMember,
    User,
)
from plane.db.models.project import ROLE
from plane.settings.storage import S3Storage
from plane.utils.attachments import get_attachment_disposition, validate_project_attachment_size
from plane.utils.content_validator import validate_html_content
from plane.utils.html_processor import strip_tags
from plane.utils.path_validator import sanitize_filename


def _json_list(value, field_name):
    if value in (None, ""):
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise serializers.ValidationError({field_name: "Provide a JSON array."}) from exc
    if not isinstance(parsed, list):
        raise serializers.ValidationError({field_name: "Provide a JSON array."})
    return parsed


def _boolean(value):
    return value is True or str(value).lower() in {"1", "true", "yes", "on"}


def _active_project_user_ids(project):
    return set(
        ProjectMember.objects.filter(
            project=project,
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).values_list("member_id", flat=True)
    )


def _resolve_recipients(project, *, all_members, user_ids, group_ids):
    eligible_ids = _active_project_user_ids(project)
    selected_ids = set(eligible_ids if all_members else [])

    try:
        normalized_user_ids = {uuid.UUID(str(value)) for value in user_ids}
    except (TypeError, ValueError, AttributeError) as exc:
        raise serializers.ValidationError({"user_ids": "Provide valid user identifiers."}) from exc
    invalid_user_ids = normalized_user_ids - eligible_ids
    if invalid_user_ids:
        raise serializers.ValidationError({"user_ids": "All selected users must be active project members."})
    selected_ids.update(normalized_user_ids)

    try:
        normalized_group_ids = {uuid.UUID(str(value)) for value in group_ids}
    except (TypeError, ValueError, AttributeError) as exc:
        raise serializers.ValidationError({"group_ids": "Provide valid group identifiers."}) from exc
    valid_group_ids = set(
        ProjectUserGroup.objects.filter(
            project=project,
            id__in=normalized_group_ids,
            archived_at__isnull=True,
        ).values_list("id", flat=True)
    )
    if valid_group_ids != normalized_group_ids:
        raise serializers.ValidationError({"group_ids": "All selected groups must be active."})
    group_member_ids = set(
        ProjectUserGroupMember.objects.filter(
            project=project,
            group_id__in=valid_group_ids,
            member_id__in=eligible_ids,
        ).values_list("member_id", flat=True)
    )
    selected_ids.update(group_member_ids)
    if not selected_ids:
        raise serializers.ValidationError({"recipients": "Select at least one recipient."})
    return selected_ids


def _is_project_admin(user, project):
    return ProjectMember.objects.filter(
        project=project,
        member=user,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists()


class ProjectAnnouncementAdminEndpoint(BaseAPIView):
    permission_classes = [ProjectAdminPermission]
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_project(self, slug, project_id):
        return get_object_or_404(Project, id=project_id, workspace__slug=slug)

    def get(self, request, slug, project_id, pk=None):
        project = self.get_project(slug, project_id)
        if request.query_params.get("options") == "true" and pk is None:
            users = User.objects.filter(id__in=_active_project_user_ids(project)).order_by(
                "first_name", "last_name", "email"
            )
            groups = ProjectUserGroup.objects.filter(
                project=project,
                archived_at__isnull=True,
            ).prefetch_related("memberships__member")
            return Response(
                {
                    "users": UserLiteSerializer(users, many=True).data,
                    "groups": ProjectUserGroupSerializer(
                        groups,
                        many=True,
                        context={"project": project},
                    ).data,
                }
            )
        queryset = (
            ProjectAnnouncement.objects.filter(project=project)
            .prefetch_related(
                "attachments__asset",
                "recipients",
            )
            .select_related("created_by")
        )
        if pk:
            announcement = get_object_or_404(queryset, pk=pk)
            data = ProjectAnnouncementSerializer(
                announcement,
                context={"include_statistics": True},
            ).data
            data["recipients"] = ProjectAnnouncementRecipientSerializer(
                announcement.recipients.select_related("user").all(),
                many=True,
            ).data
            return Response(data)
        return Response(
            ProjectAnnouncementSerializer(
                queryset,
                many=True,
                context={"include_statistics": True},
            ).data
        )

    def post(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        title = str(request.data.get("title") or "").strip()
        content_html = str(request.data.get("content_html") or "").strip()
        announcement_type = str(request.data.get("announcement_type") or "standard").lower()
        if not title:
            raise serializers.ValidationError({"title": "Title is required."})
        if len(title) > 255:
            raise serializers.ValidationError({"title": "Title must not exceed 255 characters."})
        if announcement_type not in ProjectAnnouncement.AnnouncementType.values:
            raise serializers.ValidationError({"announcement_type": "Unsupported notification type."})
        is_valid, error, clean_html = validate_html_content(content_html)
        if not is_valid:
            raise serializers.ValidationError({"content_html": error})
        content_plain = strip_tags(clean_html or "").replace("&nbsp;", " ").strip()
        if not content_plain:
            raise serializers.ValidationError({"content_html": "Message is required."})

        all_members = _boolean(request.data.get("all_members"))
        user_ids = _json_list(request.data.get("user_ids"), "user_ids")
        group_ids = _json_list(request.data.get("group_ids"), "group_ids")
        recipient_ids = _resolve_recipients(
            project,
            all_members=all_members,
            user_ids=user_ids,
            group_ids=group_ids,
        )
        files = request.FILES.getlist("attachments") or request.FILES.getlist("attachments[]")
        for uploaded_file in files:
            validate_project_attachment_size(
                project=project,
                mime_type=uploaded_file.content_type,
                filename=uploaded_file.name,
                size=uploaded_file.size,
            )

        selection = {
            "all_members": all_members,
            "user_ids": [str(value) for value in user_ids],
            "group_ids": [str(value) for value in group_ids],
        }
        storage = S3Storage(request=request)
        uploaded_keys = []
        try:
            with transaction.atomic():
                announcement = ProjectAnnouncement.objects.create(
                    project=project,
                    title=title,
                    content_html=clean_html,
                    content_plain=content_plain,
                    announcement_type=announcement_type,
                    recipient_selection=selection,
                    recipient_count=len(recipient_ids),
                    created_by=request.user,
                )
                for sort_order, uploaded_file in enumerate(files):
                    file_name = sanitize_filename(uploaded_file.name) or "attachment"
                    content_type = uploaded_file.content_type or "application/octet-stream"
                    asset_key = (
                        f"{project.workspace_id}/project-announcements/{announcement.id}/{uuid.uuid4().hex}-{file_name}"
                    )
                    if not storage.upload_file(
                        file_obj=uploaded_file,
                        object_name=asset_key,
                        content_type=content_type,
                    ):
                        raise serializers.ValidationError({"attachments": "Could not upload a file. Please try again."})
                    uploaded_keys.append(asset_key)
                    asset = FileAsset.objects.create(
                        attributes={
                            "name": file_name,
                            "type": content_type,
                            "size": uploaded_file.size,
                        },
                        asset=asset_key,
                        size=uploaded_file.size,
                        workspace=project.workspace,
                        project=project,
                        entity_type=FileAsset.EntityTypeContext.PROJECT_ANNOUNCEMENT_ATTACHMENT,
                        entity_identifier=str(announcement.id),
                        is_uploaded=True,
                        created_by=request.user,
                    )
                    ProjectAnnouncementAttachment.objects.create(
                        project=project,
                        announcement=announcement,
                        asset=asset,
                        sort_order=sort_order,
                        created_by=request.user,
                    )

                notifications = Notification.objects.bulk_create(
                    [
                        Notification(
                            workspace=project.workspace,
                            project=project,
                            data={
                                "project_announcement": {
                                    "id": str(announcement.id),
                                    "title": announcement.title,
                                    "type": announcement.announcement_type,
                                    "project_id": str(project.id),
                                    "project_name": project.name,
                                    "attachment_count": len(files),
                                }
                            },
                            entity_identifier=announcement.id,
                            entity_name="project_announcement",
                            title=announcement.title,
                            message={"type": announcement.announcement_type},
                            message_html=announcement.content_html,
                            message_stripped=announcement.content_plain,
                            sender="project_announcement",
                            triggered_by=request.user,
                            receiver_id=user_id,
                            created_by=request.user,
                        )
                        for user_id in recipient_ids
                    ]
                )
                notification_by_user = {notification.receiver_id: notification for notification in notifications}
                ProjectAnnouncementRecipient.objects.bulk_create(
                    [
                        ProjectAnnouncementRecipient(
                            project=project,
                            workspace=project.workspace,
                            announcement=announcement,
                            user_id=user_id,
                            notification=notification_by_user[user_id],
                            created_by=request.user,
                        )
                        for user_id in recipient_ids
                    ]
                )
        except Exception:
            if uploaded_keys:
                storage.delete_files(uploaded_keys)
            raise

        transaction.on_commit(lambda: dispatch_project_announcement.delay(str(announcement.id)))
        announcement = (
            ProjectAnnouncement.objects.filter(pk=announcement.pk)
            .prefetch_related("attachments__asset", "recipients")
            .select_related("created_by")
            .get()
        )
        return Response(
            ProjectAnnouncementSerializer(
                announcement,
                context={"include_statistics": True},
            ).data,
            status=status.HTTP_201_CREATED,
        )


class ProjectAnnouncementUserEndpoint(BaseAPIView):
    def get_recipient(self, request, slug, pk):
        return get_object_or_404(
            ProjectAnnouncementRecipient.objects.select_related(
                "announcement",
                "announcement__project",
                "announcement__created_by",
                "notification",
            ).prefetch_related("announcement__attachments__asset"),
            announcement_id=pk,
            announcement__workspace__slug=slug,
            user=request.user,
        )

    def get(self, request, slug, pk=None):
        if pk is None:
            rows = (
                ProjectAnnouncementRecipient.objects.filter(
                    announcement__workspace__slug=slug,
                    announcement__announcement_type=ProjectAnnouncement.AnnouncementType.IMPORTANT,
                    user=request.user,
                    read_at__isnull=True,
                )
                .select_related("announcement", "announcement__project", "announcement__created_by", "notification")
                .prefetch_related("announcement__attachments__asset")
                .order_by("-announcement__sent_at")
            )
            return Response(
                [
                    ProjectAnnouncementDetailSerializer(
                        row.announcement,
                        context={"recipient": row},
                    ).data
                    for row in rows
                ]
            )

        recipient = self.get_recipient(request, slug, pk)
        if recipient.read_at is None:
            now = timezone.now()
            recipient.read_at = now
            recipient.save(update_fields=["read_at", "updated_at"])
            if recipient.notification_id:
                Notification.objects.filter(pk=recipient.notification_id).update(read_at=now)
        return Response(
            ProjectAnnouncementDetailSerializer(
                recipient.announcement,
                context={"recipient": recipient},
            ).data
        )

    def post(self, request, slug, pk):
        recipient = self.get_recipient(request, slug, pk)
        now = timezone.now()
        ProjectAnnouncementRecipient.objects.filter(pk=recipient.pk).update(
            modal_dismissed_at=now,
            modal_dismiss_count=F("modal_dismiss_count") + 1,
        )
        return Response({"dismissed_at": now}, status=status.HTTP_200_OK)


class ProjectAnnouncementAttachmentEndpoint(BaseAPIView):
    def get(self, request, slug, announcement_id, pk):
        attachment = get_object_or_404(
            ProjectAnnouncementAttachment.objects.select_related(
                "announcement",
                "announcement__project",
                "asset",
            ),
            pk=pk,
            announcement_id=announcement_id,
            announcement__workspace__slug=slug,
        )
        has_access = ProjectAnnouncementRecipient.objects.filter(
            announcement_id=announcement_id,
            user=request.user,
        ).exists() or _is_project_admin(request.user, attachment.announcement.project)
        if not has_access:
            raise Http404
        disposition = get_attachment_disposition(
            attachment.asset.attributes.get("type"),
            request.query_params.get("disposition"),
        )
        url = S3Storage(request=request).generate_presigned_url(
            object_name=attachment.asset.asset.name,
            disposition=disposition,
            filename=attachment.asset.attributes.get("name"),
            expiration=300,
        )
        if not url:
            return Response({"error": "Could not prepare the file."}, status=status.HTTP_502_BAD_GATEWAY)
        return HttpResponseRedirect(url)
