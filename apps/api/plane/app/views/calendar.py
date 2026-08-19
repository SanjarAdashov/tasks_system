from datetime import timedelta, timezone as dt_timezone
import html
from urllib.parse import quote
from zoneinfo import ZoneInfo

# ruff: noqa: E501 -- standalone, inline-styled public RSVP document

from django.core import signing
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.renderers import JSONRenderer, StaticHTMLRenderer
from rest_framework.response import Response

from plane.app.serializers import (
    CalendarConnectionSerializer,
    CalendarPreferenceSerializer,
    MeetingCommentSerializer,
    MeetingAttachmentSerializer,
    MeetingParticipantSerializer,
    MeetingSerializer,
    MeetingTypeSerializer,
    WorkspaceCalendarSettingsSerializer,
    WorkspaceHolidaySerializer,
)
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    CalendarConnection,
    CalendarPreference,
    Issue,
    Meeting,
    MeetingActivity,
    MeetingComment,
    MeetingExternalEvent,
    MeetingAttachment,
    MeetingParticipant,
    MeetingRecurrenceException,
    MeetingResponseStatus,
    MeetingStatus,
    MeetingType,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceCalendarSettings,
    WorkspaceHoliday,
    WorkspaceMember,
    FileAsset,
)
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import encrypt_data
from plane.utils.calendar import (
    active_workspace_member,
    complete_finished_meetings,
    expand_recurrence,
    find_available_slots,
    issue_meeting_participants,
    meeting_detail_access,
    meeting_manage_access,
    meetings_visible_to,
    parse_range,
    recurrence_occurs_at,
    read_signed_calendar_token,
    user_busy_intervals,
)
from plane.utils.issue_access import can_view_issue, is_instance_admin, is_project_admin, is_workspace_admin
from plane.utils.holiday_calendar import HolidayCalendarError, sync_workspace_holidays
from plane.settings.storage import S3Storage
from plane.utils.attachments import get_attachment_disposition, validate_project_attachment_size
from plane.utils.external_calendar import (
    CalendarProviderError,
    build_oauth_authorization_url,
    discover_caldav_calendars_with_credentials,
    exchange_oauth_code,
    list_provider_calendars,
    oauth_account_profile,
    read_oauth_state,
    safe_return_url,
    save_oauth_connection,
)
from plane.utils.host import base_host


class WorkspaceCalendarPermission(BasePermission):
    def has_permission(self, request, view):
        workspace = Workspace.objects.filter(slug=view.workspace_slug).first()
        return bool(
            workspace and (is_instance_admin(request.user) or active_workspace_member(request.user, workspace.id))
        )


class ProjectMeetingTypePermission(BasePermission):
    def has_permission(self, request, view):
        if is_instance_admin(request.user) or is_project_admin(request.user, view.project_id):
            return True
        return bool(
            request.method in ("GET", "HEAD", "OPTIONS")
            and ProjectMember.objects.filter(
                project_id=view.project_id,
                member=request.user,
                is_active=True,
            ).exists()
        )


class MeetingTypeViewSet(BaseViewSet):
    model = MeetingType
    serializer_class = MeetingTypeSerializer
    permission_classes = [ProjectMeetingTypePermission]

    def get_project(self):
        return get_object_or_404(Project, id=self.project_id, workspace__slug=self.workspace_slug)

    def get_queryset(self):
        return MeetingType.objects.filter(workspace__slug=self.workspace_slug, project_id=self.project_id).order_by(
            "sort_order", "name"
        )

    @transaction.atomic
    def create(self, request, slug, project_id):
        project = self.get_project()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("is_default"):
            MeetingType.objects.filter(project=project, is_default=True).update(is_default=False)
        try:
            meeting_type = serializer.save(project=project, workspace=project.workspace)
        except IntegrityError:
            return Response({"name": "A meeting type with this name already exists."}, status=409)
        return Response(self.get_serializer(meeting_type).data, status=201)

    @transaction.atomic
    def partial_update(self, request, slug, project_id, pk):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("is_default"):
            MeetingType.objects.filter(project=instance.project, is_default=True).exclude(id=instance.id).update(
                is_default=False
            )
        try:
            serializer.save()
        except IntegrityError:
            return Response({"name": "A meeting type with this name already exists."}, status=409)
        return Response(serializer.data)

    def destroy(self, request, slug, project_id, pk):
        self.get_object().delete()
        return Response(status=204)

    @transaction.atomic
    def reorder(self, request, slug, project_id):
        ids = request.data.get("ids") or []
        rows = list(self.get_queryset().filter(id__in=ids))
        if len(rows) != len(set(ids)):
            return Response({"ids": "One or more meeting types are invalid."}, status=400)
        by_id = {str(row.id): row for row in rows}
        for index, value in enumerate(ids):
            row = by_id[str(value)]
            row.sort_order = float(index + 1)
            row.save(update_fields=["sort_order", "updated_at"])
        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class MeetingViewSet(BaseViewSet):
    model = Meeting
    serializer_class = MeetingSerializer
    permission_classes = [WorkspaceCalendarPermission]

    def get_workspace(self):
        return get_object_or_404(Workspace, slug=self.workspace_slug)

    def get_queryset(self):
        queryset = Meeting.objects.select_related(
            "workspace", "project", "issue", "meeting_type", "organizer"
        ).prefetch_related(
            "participants__user",
            "reminders",
            "comments__user",
            "activities__actor",
            "attachments__asset",
            "recurrence_exceptions",
        )
        return meetings_visible_to(queryset, self.request.user, self.get_workspace())

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["workspace"] = self.get_workspace()
        return context

    def list(self, request, slug):
        complete_finished_meetings()
        now = timezone.now()
        range_start = parse_range(request.query_params.get("start"), fallback=now - timedelta(days=31))
        range_end = parse_range(request.query_params.get("end"), fallback=now + timedelta(days=62))
        if range_end <= range_start or range_end - range_start > timedelta(days=730):
            return Response({"end": "Calendar range must be positive and at most two years."}, status=400)
        queryset = (
            self.get_queryset()
            .filter(starts_at__lt=range_end)
            .filter(Q(ends_at__gt=range_start) | ~Q(recurrence_rule=""))
        )
        if request.query_params.get("show_cancelled") != "true":
            queryset = queryset.exclude(status=MeetingStatus.CANCELLED)
        project_ids = request.query_params.getlist("project_id")
        if project_ids:
            queryset = queryset.filter(project_id__in=project_ids)
        type_ids = request.query_params.getlist("meeting_type_id")
        if type_ids:
            queryset = queryset.filter(meeting_type_id__in=type_ids)
        issue_id = request.query_params.get("issue_id")
        if issue_id:
            queryset = queryset.filter(issue_id=issue_id)

        meetings = list(queryset)
        occurrences = []
        for meeting in meetings:
            for occurrence in expand_recurrence(meeting, range_start, range_end):
                occurrences.append(
                    {
                        "meeting_id": str(meeting.id),
                        "occurrence_id": occurrence["occurrence_id"],
                        "original_starts_at": occurrence["original_starts_at"],
                        "starts_at": occurrence["starts_at"],
                        "ends_at": occurrence["ends_at"],
                    }
                )

        external = MeetingExternalEvent.objects.filter(
            connection__user=request.user,
            connection__status="CONNECTED",
            meeting__isnull=True,
            is_deleted_at_provider=False,
            starts_at__lt=range_end,
            ends_at__gt=range_start,
        ).select_related("connection")
        external_payload = [
            {
                "id": str(item.id),
                "meeting_id": str(item.meeting_id) if item.meeting_id else None,
                "provider": item.connection.provider,
                "title": item.title,
                "starts_at": item.starts_at,
                "ends_at": item.ends_at,
                "all_day": item.all_day,
                "availability": item.availability,
            }
            for item in external
        ]
        holidays = WorkspaceHoliday.objects.filter(
            workspace=self.get_workspace(),
            date__gte=range_start.date(),
            date__lte=range_end.date(),
        )
        return Response(
            {
                "meetings": self.get_serializer(meetings, many=True).data,
                "occurrences": occurrences,
                "external_events": external_payload,
                "holidays": WorkspaceHolidaySerializer(holidays, many=True).data,
            }
        )

    def create(self, request, slug):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        meeting = serializer.save()
        return Response(self.get_serializer(meeting).data, status=201)

    def partial_update(self, request, slug, pk):
        meeting = self.get_object()
        if not meeting_manage_access(request.user, meeting):
            return Response(
                {"error": "Only the organizer or a project administrator can edit this meeting."},
                status=403,
            )
        serializer = self.get_serializer(meeting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def destroy(self, request, slug, pk):
        meeting = self.get_object()
        if not meeting_manage_access(request.user, meeting):
            return Response({"error": "You cannot permanently delete this meeting."}, status=403)
        meeting.status = MeetingStatus.CANCELLED
        meeting.cancelled_at = timezone.now()
        meeting.save(update_fields=["status", "cancelled_at", "updated_at"])
        MeetingActivity.objects.create(meeting=meeting, actor=request.user, event="DELETED")
        # Hide immediately without cascading to participants/provider links. A
        # retryable worker task removes external copies before hard deletion.
        Meeting.all_objects.filter(pk=meeting.id).update(deleted_at=timezone.now())
        from plane.bgtasks.calendar_task import finalize_deleted_meeting

        transaction.on_commit(lambda: finalize_deleted_meeting.delay(str(meeting.id)))
        return Response(status=204)

    def cancel(self, request, slug, pk):
        meeting = self.get_object()
        if not meeting_manage_access(request.user, meeting):
            return Response({"error": "You cannot cancel this meeting."}, status=403)
        if meeting.status != MeetingStatus.CANCELLED:
            meeting.status = MeetingStatus.CANCELLED
            meeting.cancelled_at = timezone.now()
            meeting.save(update_fields=["status", "cancelled_at", "updated_at"])
            MeetingActivity.objects.create(
                meeting=meeting,
                actor=request.user,
                event="CANCELLED",
                details={"reason": request.data.get("reason", "")},
            )
            from plane.bgtasks.calendar_notification_task import send_meeting_notifications
            from plane.bgtasks.calendar_task import sync_meeting_to_external_calendars

            transaction.on_commit(
                lambda: (
                    send_meeting_notifications.delay(str(meeting.id), "CANCELLED"),
                    sync_meeting_to_external_calendars.delay(str(meeting.id)),
                )
            )
        return Response(self.get_serializer(meeting).data)

    @transaction.atomic
    def transfer(self, request, slug, pk):
        meeting = self.get_object()
        if not meeting_manage_access(request.user, meeting):
            return Response({"error": "You cannot transfer this meeting."}, status=403)
        target = get_object_or_404(User, id=request.data.get("organizer_id"), is_active=True, blocked_at__isnull=True)
        target_participant = meeting.participants.filter(user=target, removed_at__isnull=True).first()
        if not target_participant:
            return Response({"organizer_id": "The new organizer must be an active participant."}, status=400)
        previous_id = meeting.organizer_id
        meeting.organizer = target
        meeting.save(update_fields=["organizer", "updated_at"])
        target_participant.response_status = MeetingResponseStatus.ACCEPTED
        target_participant.responded_at = timezone.now()
        target_participant.save(update_fields=["response_status", "responded_at", "updated_at"])
        MeetingActivity.objects.create(
            meeting=meeting,
            actor=request.user,
            event="ORGANIZER_TRANSFERRED",
            details={"from": str(previous_id), "to": str(target.id)},
        )
        from plane.bgtasks.calendar_notification_task import send_meeting_notifications
        from plane.bgtasks.calendar_task import sync_meeting_to_external_calendars

        transaction.on_commit(
            lambda: (
                send_meeting_notifications.delay(str(meeting.id), "UPDATED"),
                sync_meeting_to_external_calendars.delay(str(meeting.id)),
            )
        )
        return Response(self.get_serializer(meeting).data)

    def respond(self, request, slug, pk):
        meeting = self.get_object()
        participant = get_object_or_404(MeetingParticipant, meeting=meeting, user=request.user, removed_at__isnull=True)
        value = request.data.get("response_status")
        if value not in MeetingResponseStatus.values:
            return Response({"response_status": "Invalid response."}, status=400)
        participant.response_status = value
        participant.responded_at = timezone.now()
        participant.save(update_fields=["response_status", "responded_at", "updated_at"])
        MeetingActivity.objects.create(
            meeting=meeting,
            actor=request.user,
            event="RSVP_CHANGED",
            details={"participant_id": str(participant.id), "response_status": value},
        )
        from plane.bgtasks.calendar_notification_task import send_meeting_response_notification

        transaction.on_commit(lambda: send_meeting_response_notification.delay(str(participant.id)))
        return Response(MeetingParticipantSerializer(participant).data)

    def occurrence(self, request, slug, pk):
        meeting = self.get_object()
        original_starts_at = parse_range(request.data.get("original_starts_at"), fallback=None)
        if original_starts_at is None:
            return Response({"original_starts_at": "This field is required."}, status=400)
        # RFC 5545 recurrence expansion works at second precision. Normalize API
        # input so browser-generated timestamps with milliseconds match the series.
        original_starts_at = original_starts_at.replace(microsecond=0)
        action = request.data.get("action")
        if action not in MeetingRecurrenceException.Action.values:
            return Response({"action": "Invalid occurrence action."}, status=400)
        if not meeting_manage_access(request.user, meeting):
            return Response({"error": "You cannot edit this occurrence."}, status=403)
        if not recurrence_occurs_at(meeting, original_starts_at):
            return Response({"original_starts_at": "This timestamp is not an occurrence in the series."}, status=400)
        exception, _ = MeetingRecurrenceException.objects.update_or_create(
            meeting=meeting,
            original_starts_at=original_starts_at,
            defaults={"action": action, "overrides": request.data.get("overrides") or {}},
        )
        MeetingActivity.objects.create(
            meeting=meeting,
            actor=request.user,
            event="OCCURRENCE_UPDATED",
            details={"original_starts_at": original_starts_at.isoformat(), "action": exception.action},
        )
        from plane.bgtasks.calendar_notification_task import send_meeting_notifications
        from plane.bgtasks.calendar_task import sync_meeting_to_external_calendars

        transaction.on_commit(
            lambda: (
                send_meeting_notifications.delay(str(meeting.id), "UPDATED"),
                sync_meeting_to_external_calendars.delay(str(meeting.id)),
            )
        )
        return Response({"id": str(exception.id), "action": exception.action})


class IssueMeetingDefaultsEndpoint(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]

    def get(self, request, slug, project_id, issue_id):
        issue = get_object_or_404(
            Issue.unscoped_objects.select_related("project", "workspace").prefetch_related(
                "issue_assignee",
                "issue_subscribers",
                "access_group_links__group__memberships",
                "work_item_property_values__property",
            ),
            id=issue_id,
            project_id=project_id,
            workspace__slug=slug,
        )
        if not can_view_issue(request.user, issue):
            raise Http404
        meeting_type = MeetingType.objects.filter(project_id=project_id, is_default=True).first()
        return Response(
            {
                "title": f"{issue.project.identifier}-{issue.sequence_id} — {issue.name}",
                "project_id": str(project_id),
                "issue_id": str(issue.id),
                "meeting_type_id": str(meeting_type.id) if meeting_type else None,
                "participants": issue_meeting_participants(issue, request.user),
            }
        )


class MeetingCommentViewSet(BaseViewSet):
    model = MeetingComment
    serializer_class = MeetingCommentSerializer
    permission_classes = [WorkspaceCalendarPermission]

    def get_meeting(self):
        queryset = meetings_visible_to(Meeting.objects.all(), self.request.user)
        return get_object_or_404(
            queryset,
            id=self.kwargs["meeting_id"],
            workspace__slug=self.kwargs["slug"],
        )

    def get_queryset(self):
        meeting = self.get_meeting()
        if not meeting_detail_access(self.request.user, meeting):
            return MeetingComment.objects.none()
        return MeetingComment.objects.filter(meeting=meeting).select_related("user")

    def create(self, request, slug, meeting_id):
        meeting = self.get_meeting()
        if not meeting_detail_access(request.user, meeting):
            return Response({"error": "Meeting details are unavailable."}, status=403)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(meeting=meeting, user=request.user)
        MeetingActivity.objects.create(meeting=meeting, actor=request.user, event="COMMENTED")
        return Response(self.get_serializer(comment).data, status=201)


class MeetingAttachmentViewSet(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]
    parser_classes = (MultiPartParser, FormParser)

    def get_meeting(self, request, slug, meeting_id):
        meeting = get_object_or_404(
            meetings_visible_to(Meeting.objects.select_related("workspace", "project", "organizer"), request.user),
            id=meeting_id,
            workspace__slug=slug,
        )
        if not meeting_detail_access(request.user, meeting):
            raise Http404
        return meeting

    def get(self, request, slug, meeting_id, pk=None):
        meeting = self.get_meeting(request, slug, meeting_id)
        rows = MeetingAttachment.objects.filter(meeting=meeting).select_related("asset")
        if not pk:
            return Response(MeetingAttachmentSerializer(rows, many=True, context={"request": request}).data)
        attachment = get_object_or_404(rows, pk=pk)
        storage = S3Storage(request=request)
        disposition = get_attachment_disposition(
            attachment.asset.attributes.get("type"), request.query_params.get("disposition")
        )
        url = storage.generate_presigned_url(
            object_name=attachment.asset.asset.name,
            disposition=disposition,
            filename=attachment.asset.attributes.get("name"),
            expiration=300,
        )
        return HttpResponseRedirect(url)

    @transaction.atomic
    def post(self, request, slug, meeting_id):
        meeting = self.get_meeting(request, slug, meeting_id)
        uploaded_file = request.FILES.get("asset")
        if not uploaded_file:
            return Response({"asset": "Select a file."}, status=400)
        if meeting.project_id:
            validate_project_attachment_size(
                project=meeting.project,
                mime_type=uploaded_file.content_type,
                filename=uploaded_file.name,
                size=uploaded_file.size,
            )
        asset = FileAsset.objects.create(
            attributes={
                "name": uploaded_file.name,
                "type": uploaded_file.content_type or "application/octet-stream",
                "size": uploaded_file.size,
            },
            asset=uploaded_file,
            size=uploaded_file.size,
            workspace=meeting.workspace,
            project=meeting.project,
            user=request.user if not meeting.workspace_id else None,
            entity_type=FileAsset.EntityTypeContext.MEETING_ATTACHMENT,
            entity_identifier=str(meeting.id),
            is_uploaded=True,
            created_by=request.user,
        )
        attachment = MeetingAttachment.objects.create(
            meeting=meeting,
            asset=asset,
            shared_with_guests=request.data.get("shared_with_guests") in ("true", "1", True),
            created_by=request.user,
        )
        MeetingActivity.objects.create(
            meeting=meeting,
            actor=request.user,
            event="ATTACHMENT_ADDED",
            details={"attachment_id": str(attachment.id), "name": uploaded_file.name},
        )
        return Response(
            MeetingAttachmentSerializer(attachment, context={"request": request}).data,
            status=201,
        )

    @transaction.atomic
    def patch(self, request, slug, meeting_id, pk):
        meeting = self.get_meeting(request, slug, meeting_id)
        if not meeting_manage_access(request.user, meeting):
            return Response({"error": "Only the organizer can change guest attachment access."}, status=403)
        attachment = get_object_or_404(MeetingAttachment, meeting=meeting, pk=pk)
        attachment.shared_with_guests = bool(request.data.get("shared_with_guests"))
        attachment.save(update_fields=["shared_with_guests", "updated_at"])
        return Response(MeetingAttachmentSerializer(attachment, context={"request": request}).data)

    @transaction.atomic
    def delete(self, request, slug, meeting_id, pk):
        meeting = self.get_meeting(request, slug, meeting_id)
        attachment = get_object_or_404(MeetingAttachment.objects.select_related("asset"), meeting=meeting, pk=pk)
        if attachment.created_by_id != request.user.id and not meeting_manage_access(request.user, meeting):
            return Response({"error": "You cannot delete this attachment."}, status=403)
        asset = attachment.asset
        name = asset.attributes.get("name") or "attachment"
        attachment.delete(soft=False)
        asset.asset.delete(save=False)
        asset.delete(soft=False)
        MeetingActivity.objects.create(
            meeting=meeting,
            actor=request.user,
            event="ATTACHMENT_REMOVED",
            details={"name": name},
        )
        return Response(status=204)


class CalendarAvailabilityEndpoint(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]

    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        user_ids = request.data.get("user_ids") or []
        workspace_user_ids = set(
            WorkspaceMember.objects.filter(
                workspace=workspace,
                member_id__in=user_ids,
                is_active=True,
            ).values_list("member_id", flat=True)
        )
        users = list(
            User.objects.filter(
                id__in=workspace_user_ids,
                is_active=True,
                blocked_at__isnull=True,
            ).select_related("calendar_preference")
        )
        if len(users) != len(set(user_ids)):
            return Response({"user_ids": "One or more users are unavailable."}, status=400)
        now = timezone.now()
        range_start = parse_range(request.data.get("start"), fallback=now)
        range_end = parse_range(request.data.get("end"), fallback=now + timedelta(days=7))
        if range_end <= range_start or range_end - range_start > timedelta(days=31):
            return Response({"end": "Availability range must be positive and at most 31 days."}, status=400)
        calendar_settings, _ = WorkspaceCalendarSettings.objects.get_or_create(workspace=workspace)
        busy = user_busy_intervals(user_ids, range_start, range_end, exclude_meeting_id=request.data.get("meeting_id"))
        slots = []
        if request.data.get("find_slots"):
            slots = find_available_slots(
                users=users,
                required_user_ids=request.data.get("required_user_ids") or user_ids,
                optional_user_ids=request.data.get("optional_user_ids") or [],
                range_start=range_start,
                range_end=range_end,
                duration_minutes=request.data.get("duration_minutes") or 30,
                working_hours=calendar_settings.working_hours,
                workspace_id=workspace.id,
            )
        return Response({"busy": busy, "suggested_slots": slots})


class WorkspaceCalendarSettingsEndpoint(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]

    def get_workspace(self):
        return get_object_or_404(Workspace, slug=self.workspace_slug)

    def get(self, request, slug):
        calendar_settings, _ = WorkspaceCalendarSettings.objects.get_or_create(workspace=self.get_workspace())
        return Response(WorkspaceCalendarSettingsSerializer(calendar_settings).data)

    def patch(self, request, slug):
        workspace = self.get_workspace()
        if not (is_instance_admin(request.user) or is_workspace_admin(request.user, workspace.id)):
            return Response({"error": "Only a workspace administrator can change calendar settings."}, status=403)
        calendar_settings, _ = WorkspaceCalendarSettings.objects.get_or_create(workspace=workspace)
        serializer = WorkspaceCalendarSettingsSerializer(calendar_settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class WorkspaceHolidaySyncEndpoint(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]

    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        if not (is_instance_admin(request.user) or is_workspace_admin(request.user, workspace.id)):
            return Response({"error": "Only a workspace administrator can refresh holidays."}, status=403)
        calendar_settings, _ = WorkspaceCalendarSettings.objects.get_or_create(workspace=workspace)
        try:
            result = sync_workspace_holidays(calendar_settings)
        except HolidayCalendarError as exc:
            return Response({"error": str(exc)}, status=503)
        return Response(
            {
                **result,
                "settings": WorkspaceCalendarSettingsSerializer(calendar_settings).data,
            }
        )


class WorkspaceHolidayViewSet(BaseViewSet):
    model = WorkspaceHoliday
    serializer_class = WorkspaceHolidaySerializer
    permission_classes = [WorkspaceCalendarPermission]

    def get_workspace(self):
        return get_object_or_404(Workspace, slug=self.workspace_slug)

    def get_queryset(self):
        queryset = WorkspaceHoliday.objects.filter(workspace=self.get_workspace())
        if self.request.query_params.get("start"):
            queryset = queryset.filter(date__gte=self.request.query_params["start"])
        if self.request.query_params.get("end"):
            queryset = queryset.filter(date__lte=self.request.query_params["end"])
        return queryset.order_by("date", "source")

    def _can_manage(self, user, workspace):
        return is_instance_admin(user) or is_workspace_admin(user, workspace.id)

    def create(self, request, slug):
        workspace = self.get_workspace()
        if not self._can_manage(request.user, workspace):
            return Response({"error": "Only a workspace administrator can manage holidays."}, status=403)
        data = {**request.data, "source": request.data.get("source") or WorkspaceHoliday.Source.CORPORATE}
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        holiday = serializer.save(
            workspace=workspace,
            is_override=data.get("source") == WorkspaceHoliday.Source.MANUAL,
        )
        return Response(self.get_serializer(holiday).data, status=201)

    def partial_update(self, request, slug, pk):
        workspace = self.get_workspace()
        if not self._can_manage(request.user, workspace):
            return Response({"error": "Only a workspace administrator can manage holidays."}, status=403)
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(source=WorkspaceHoliday.Source.MANUAL, is_override=True)
        return Response(serializer.data)

    def destroy(self, request, slug, pk):
        workspace = self.get_workspace()
        if not self._can_manage(request.user, workspace):
            return Response({"error": "Only a workspace administrator can manage holidays."}, status=403)
        self.get_object().delete()
        return Response(status=204)


class CalendarPreferenceEndpoint(BaseAPIView):
    def get(self, request):
        preference, _ = CalendarPreference.objects.get_or_create(user=request.user)
        return Response(CalendarPreferenceSerializer(preference).data)

    def patch(self, request):
        preference, _ = CalendarPreference.objects.get_or_create(user=request.user)
        serializer = CalendarPreferenceSerializer(preference, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class CalendarConnectionViewSet(BaseViewSet):
    model = CalendarConnection
    serializer_class = CalendarConnectionSerializer

    def get_queryset(self):
        return CalendarConnection.objects.filter(user=self.request.user)

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verified_calendars = []
        if serializer.validated_data.get("provider") in ("ICLOUD", "CALDAV"):
            try:
                verified_calendars = discover_caldav_calendars_with_credentials(
                    server_url=serializer.validated_data["server_url"],
                    username=serializer.validated_data["username"],
                    app_password=serializer.validated_data["app_password"],
                    account_label=serializer.validated_data.get("account_label", ""),
                    account_email=serializer.validated_data.get("account_email", ""),
                )
            except CalendarProviderError as exc:
                return Response(
                    {
                        "error": "calendar_connection_failed",
                        "detail": str(exc),
                    },
                    status=400,
                )
        try:
            connection = serializer.save()
        except IntegrityError:
            return Response({"account_email": "This calendar account is already connected."}, status=409)
        if verified_calendars:
            selected_calendars = [str(item["id"]) for item in verified_calendars if item.get("primary")]
            connection.selected_calendars = selected_calendars or [str(verified_calendars[0]["id"])]
            connection.save(update_fields=["selected_calendars", "updated_at"])
        from plane.bgtasks.calendar_task import sync_calendar_connection

        transaction.on_commit(lambda: sync_calendar_connection.delay(str(connection.id)))
        return Response(self.get_serializer(connection).data, status=201)

    def partial_update(self, request, pk):
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def destroy(self, request, pk):
        self.get_object().delete()
        return Response(status=204)

    def resync(self, request, pk):
        connection = self.get_object()
        connection.last_error = ""
        connection.last_error_at = None
        connection.save(update_fields=["last_error", "last_error_at", "updated_at"])
        from plane.bgtasks.calendar_task import sync_calendar_connection

        sync_calendar_connection.delay(str(connection.id))
        return Response({"queued": True})

    def calendars(self, request, pk):
        connection = self.get_object()
        try:
            calendars = list_provider_calendars(connection)
        except CalendarProviderError as exc:
            return Response({"error": str(exc)}, status=400)
        selected = set(connection.selected_calendars or [])
        if not selected:
            selected = {str(item["id"]) for item in calendars if item.get("primary")}
        return Response([{**item, "selected": str(item["id"]) in selected} for item in calendars])


class CalendarOAuthStartEndpoint(BaseAPIView):
    def get(self, request):
        provider = str(request.query_params.get("provider", "")).upper()
        if provider not in ("GOOGLE", "MICROSOFT"):
            return Response({"provider": "Select Google or Microsoft."}, status=400)
        purpose = request.query_params.get("purpose") or "personal_calendar"
        if purpose == "system_meet" and (provider != "GOOGLE" or not is_instance_admin(request.user)):
            return Response(
                {"error": "Only an instance administrator can connect the system Meet account."}, status=403
            )
        redirect_uri = f"{base_host(request).rstrip('/')}/api/users/me/calendar/connections/oauth/callback/"
        return_url = safe_return_url(request.query_params.get("return_url"), request)
        try:
            authorization_url = build_oauth_authorization_url(
                provider=provider,
                user_id=request.user.id,
                redirect_uri=redirect_uri,
                return_url=return_url,
                purpose=purpose,
            )
        except CalendarProviderError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response({"authorization_url": authorization_url})


class CalendarOAuthCallbackEndpoint(BaseAPIView):
    def get(self, request):
        fallback = f"{base_host(request).rstrip('/')}/profile/settings/calendars"
        try:
            state = read_oauth_state(request.query_params.get("state", ""))
            return_url = safe_return_url(state.get("return_url"), request)
            if str(request.user.id) != state.get("user_id"):
                raise CalendarProviderError("Sign in with the account that started calendar connection.")
            if request.query_params.get("error"):
                raise CalendarProviderError(
                    request.query_params.get("error_description") or "Calendar access was denied."
                )
            redirect_uri = f"{base_host(request).rstrip('/')}/api/users/me/calendar/connections/oauth/callback/"
            token_payload = exchange_oauth_code(
                provider=state["provider"],
                code=request.query_params.get("code", ""),
                redirect_uri=redirect_uri,
            )
            if state.get("purpose") == "system_meet":
                if not is_instance_admin(request.user):
                    raise CalendarProviderError("Instance administrator access is required.")
                email, _ = oauth_account_profile(state["provider"], token_payload)
                refresh_token = token_payload.get("refresh_token")
                if not refresh_token:
                    raise CalendarProviderError("Google did not return offline access. Reconnect and grant access.")
                refresh_config, _ = InstanceConfiguration.objects.get_or_create(
                    key="CALENDAR_GOOGLE_MEET_REFRESH_TOKEN",
                    defaults={"category": "CALENDAR", "is_encrypted": True},
                )
                refresh_config.category = "CALENDAR"
                refresh_config.is_encrypted = True
                refresh_config.value = encrypt_data(refresh_token)
                refresh_config.save()
                account_config, _ = InstanceConfiguration.objects.get_or_create(
                    key="CALENDAR_GOOGLE_MEET_ACCOUNT",
                    defaults={"category": "CALENDAR", "is_encrypted": False},
                )
                account_config.value = email
                account_config.category = "CALENDAR"
                account_config.save()
            else:
                connection = save_oauth_connection(
                    user=request.user,
                    provider=state["provider"],
                    token_payload=token_payload,
                )
                from plane.bgtasks.calendar_task import sync_calendar_connection

                sync_calendar_connection.delay(str(connection.id))
            separator = "&" if "?" in return_url else "?"
            return HttpResponseRedirect(f"{return_url}{separator}calendar_connected=1")
        except (CalendarProviderError, KeyError) as exc:
            separator = "&" if "?" in fallback else "?"
            return HttpResponseRedirect(f"{fallback}{separator}calendar_error={quote(str(exc))}")


def _ical_escape(value):
    return str(value or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def meeting_ics(meeting, *, method="REQUEST"):
    stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
    starts = meeting.starts_at.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ends = meeting.ends_at.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    local_starts = meeting.starts_at.astimezone(ZoneInfo(meeting.timezone))
    local_ends = meeting.ends_at.astimezone(ZoneInfo(meeting.timezone))
    date_lines = (
        [
            f"DTSTART;VALUE=DATE:{local_starts.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{local_ends.strftime('%Y%m%d')}",
        ]
        if meeting.all_day
        else [f"DTSTART:{starts}", f"DTEND:{ends}"]
    )
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//GTS Task System//Calendar//RU",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{meeting.id}@tasks.globaltravel.space",
        f"DTSTAMP:{stamp}",
        *date_lines,
        f"SUMMARY:{_ical_escape(meeting.title)}",
        f"DESCRIPTION:{_ical_escape(meeting.description)}",
        f"LOCATION:{_ical_escape(meeting.location)}",
        f"ORGANIZER;CN={_ical_escape(meeting.organizer.full_name or meeting.organizer.email)}:mailto:{meeting.organizer.email}",
        f"STATUS:{'CANCELLED' if meeting.status == MeetingStatus.CANCELLED else 'CONFIRMED'}",
    ]
    if meeting.meeting_url:
        lines.append(f"URL:{meeting.meeting_url}")
    if meeting.recurrence_rule:
        lines.append(f"RRULE:{meeting.recurrence_rule.removeprefix('RRULE:')}")
        lines.extend(
            f"EXDATE:{item.original_starts_at.astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
            for item in meeting.recurrence_exceptions.filter(action="CANCELLED", deleted_at__isnull=True).order_by(
                "original_starts_at"
            )
        )
    for participant in meeting.participants.filter(removed_at__isnull=True):
        role = "REQ-PARTICIPANT" if participant.role == "REQUIRED" else "OPT-PARTICIPANT"
        lines.append(
            f"ATTENDEE;CN={_ical_escape(participant.name)};ROLE={role};PARTSTAT={participant.response_status}:mailto:{participant.email}"
        )
    lines.extend(["END:VEVENT", "END:VCALENDAR", ""])
    return "\r\n".join(lines)


class MeetingICSEndpoint(BaseAPIView):
    permission_classes = [WorkspaceCalendarPermission]

    def get(self, request, slug, pk):
        workspace = get_object_or_404(Workspace, slug=slug)
        meeting = get_object_or_404(meetings_visible_to(Meeting.objects.all(), request.user, workspace), id=pk)
        response = HttpResponse(meeting_ics(meeting), content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="meeting-{meeting.id}.ics"'
        return response


class PublicMeetingResponseEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    renderer_classes = [JSONRenderer, StaticHTMLRenderer]

    COPY = {
        "en": {
            "attachments": "Attachments",
            "when": "When",
            "organizer": "Organizer",
            "place": "Location",
            "accept": "Accept",
            "tentative": "Maybe",
            "decline": "Decline",
            "ACCEPTED": "Attendance confirmed",
            "TENTATIVE": "The tentative response has been saved",
            "DECLINED": "The decline has been saved",
            "close": "You can close this page.",
        },
        "ru": {
            "attachments": "Вложения",
            "when": "Когда",
            "organizer": "Организатор",
            "place": "Место",
            "accept": "Принять",
            "tentative": "Возможно",
            "decline": "Отклонить",
            "ACCEPTED": "Участие подтверждено",
            "TENTATIVE": "Ответ «Возможно» сохранён",
            "DECLINED": "Отказ сохранён",
            "close": "Эту страницу можно закрыть.",
        },
        "uz": {
            "attachments": "Ilovalar",
            "when": "Vaqti",
            "organizer": "Tashkilotchi",
            "place": "Joy",
            "accept": "Qabul qilish",
            "tentative": "Ehtimol",
            "decline": "Rad etish",
            "ACCEPTED": "Ishtirok tasdiqlandi",
            "TENTATIVE": "«Ehtimol» javobi saqlandi",
            "DECLINED": "Rad etish javobi saqlandi",
            "close": "Bu sahifani yopishingiz mumkin.",
        },
    }

    def get_language(self, request):
        requested = (request.query_params.get("lang") or request.headers.get("Accept-Language", "ru")).lower()
        language = requested.split(",", 1)[0].split("-", 1)[0]
        return language if language in self.COPY else "ru"

    def get_participant(self, token):
        try:
            payload = read_signed_calendar_token(token)
            return MeetingParticipant.objects.select_related("meeting", "meeting__organizer").get(
                id=payload["participant_id"], removed_at__isnull=True
            )
        except (signing.BadSignature, MeetingParticipant.DoesNotExist, KeyError):
            raise Http404

    def get(self, request, token):
        participant = self.get_participant(token)
        meeting = participant.meeting
        attachments = [
            {
                "id": str(item.id),
                "name": item.asset.attributes.get("name") or "attachment",
                "url": request.build_absolute_uri(f"/api/calendar/public/respond/{token}/attachments/{item.id}/"),
            }
            for item in meeting.attachments.filter(shared_with_guests=True).select_related("asset")
        ]
        payload = {
            "meeting": {
                "id": str(meeting.id),
                "title": meeting.title,
                "description": meeting.description,
                "starts_at": meeting.starts_at,
                "ends_at": meeting.ends_at,
                "timezone": meeting.timezone,
                "location": meeting.location,
                "meeting_url": meeting.meeting_url,
                "status": meeting.status,
                "organizer": meeting.organizer.full_name or meeting.organizer.email,
                "attachments": attachments,
            },
            "participant": {
                "name": participant.name,
                "email": participant.email,
                "response_status": participant.response_status,
            },
        }
        if request.query_params.get("format") == "html":
            language = self.get_language(request)
            copy = self.COPY[language]
            title = html.escape(meeting.title)
            organizer = html.escape(meeting.organizer.full_name or meeting.organizer.email)
            when = f"{meeting.starts_at:%d.%m.%Y %H:%M} – {meeting.ends_at:%H:%M} ({html.escape(meeting.timezone)})"
            action = html.escape(request.path)
            attachment_links = "".join(
                f'<li style="margin:8px 0"><a style="color:#579dff" href="{html.escape(item["url"])}">{html.escape(item["name"])}</a></li>'
                for item in attachments
            )
            attachment_section = (
                f'<div style="margin:22px 0"><div style="color:#8c9bab">{copy["attachments"]}</div><ul style="padding-left:20px;margin:8px 0">{attachment_links}</ul></div>'
                if attachment_links
                else ""
            )
            page = f"""<!doctype html><html lang="{language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} — GTS Tasks System</title></head>
<body style="margin:0;background:#101214;color:#f4f5f7;font-family:Inter,Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px;box-sizing:border-box">
<main style="width:min(560px,100%);background:#181b1f;border:1px solid #343940;border-radius:16px;padding:28px;box-sizing:border-box;box-shadow:0 24px 80px rgba(0,0,0,.45)">
<div style="font-weight:700;color:#4c9aff">GTS Tasks System</div><h1 style="font-size:24px;margin:18px 0 10px">{title}</h1>
<p style="color:#b6c2cf;line-height:1.55">{html.escape(meeting.description)}</p>
<dl style="display:grid;grid-template-columns:110px 1fr;gap:10px;margin:22px 0"><dt style="color:#8c9bab">{copy["when"]}</dt><dd style="margin:0">{when}</dd><dt style="color:#8c9bab">{copy["organizer"]}</dt><dd style="margin:0">{organizer}</dd><dt style="color:#8c9bab">{copy["place"]}</dt><dd style="margin:0">{html.escape(meeting.meeting_url or meeting.location or "—")}</dd></dl>
{attachment_section}
<form method="post" action="{action}?format=html&amp;lang={language}" style="display:flex;gap:9px;flex-wrap:wrap"><button name="response_status" value="ACCEPTED" style="border:0;border-radius:8px;padding:11px 16px;background:#22a06b;color:white;font-weight:600">{copy["accept"]}</button><button name="response_status" value="TENTATIVE" style="border:1px solid #596773;border-radius:8px;padding:11px 16px;background:#252a30;color:white">{copy["tentative"]}</button><button name="response_status" value="DECLINED" style="border:1px solid #ae2e24;border-radius:8px;padding:11px 16px;background:#252a30;color:#ffb3ad">{copy["decline"]}</button></form>
</main></body></html>"""
            return HttpResponse(page, content_type="text/html; charset=utf-8")
        return Response(payload)

    def post(self, request, token):
        participant = self.get_participant(token)
        value = request.data.get("response_status")
        if value not in MeetingResponseStatus.values:
            return Response({"response_status": "Invalid response."}, status=400)
        participant.response_status = value
        participant.responded_at = timezone.now()
        participant.save(update_fields=["response_status", "responded_at", "updated_at"])
        MeetingActivity.objects.create(
            meeting=participant.meeting,
            event="GUEST_RSVP_CHANGED",
            details={"participant_id": str(participant.id), "response_status": value},
        )
        from plane.bgtasks.calendar_notification_task import send_meeting_response_notification

        transaction.on_commit(lambda: send_meeting_response_notification.delay(str(participant.id)))
        if request.query_params.get("format") == "html" or "text/html" in request.headers.get("Accept", ""):
            language = self.get_language(request)
            copy = self.COPY[language]
            page = f"""<!doctype html><html lang="{language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GTS Tasks System</title><body style="margin:0;background:#101214;color:#f4f5f7;font-family:Inter,Arial,sans-serif;min-height:100vh;display:grid;place-items:center"><main style="text-align:center"><h1>{copy[value]}</h1><p style="color:#b6c2cf">{copy["close"]}</p></main></body></html>"""
            return HttpResponse(page, content_type="text/html; charset=utf-8")
        return Response({"response_status": value})


class PublicMeetingAttachmentEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token, pk):
        try:
            payload = read_signed_calendar_token(token)
            participant = MeetingParticipant.objects.select_related("meeting").get(
                id=payload["participant_id"], removed_at__isnull=True
            )
        except (signing.BadSignature, MeetingParticipant.DoesNotExist, KeyError):
            raise Http404
        attachment = get_object_or_404(
            MeetingAttachment.objects.select_related("asset"),
            pk=pk,
            meeting=participant.meeting,
            shared_with_guests=True,
        )
        storage = S3Storage(request=request)
        url = storage.generate_presigned_url(
            object_name=attachment.asset.asset.name,
            disposition="attachment",
            filename=attachment.asset.attributes.get("name"),
            expiration=300,
        )
        return HttpResponseRedirect(url)
