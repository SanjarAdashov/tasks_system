from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from rest_framework import serializers

from plane.db.models import (
    CalendarConnection,
    CalendarPreference,
    Issue,
    Meeting,
    MeetingActivity,
    MeetingAttachment,
    MeetingComment,
    MeetingLinkSource,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingParticipantSource,
    MeetingReminder,
    MeetingType,
    MeetingVisibility,
    Project,
    ProjectMember,
    User,
    WorkspaceCalendarSettings,
    WorkspaceHoliday,
    WorkspaceMember,
)
from plane.license.utils.encryption import encrypt_data
from plane.license.utils.instance_value import get_calendar_configuration
from plane.utils.calendar import (
    meeting_detail_access,
    meeting_manage_access,
    opaque_token_hash,
    replace_meeting_participants,
)
from plane.utils.external_calendar import CalendarProviderError
from plane.utils.google_meet import create_open_google_meet
from plane.utils.issue_access import can_view_issue

from .base import BaseSerializer


class MeetingTypeSerializer(BaseSerializer):
    class Meta:
        model = MeetingType
        fields = [
            "id",
            "name",
            "color",
            "icon",
            "default_duration_minutes",
            "default_reminders",
            "default_attendance_mode",
            "is_default",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Meeting type name is required.")
        return value

    def validate_default_duration_minutes(self, value):
        if value < 5 or value > 1440:
            raise serializers.ValidationError("Duration must be between 5 minutes and 24 hours.")
        return value

    def validate_default_reminders(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Reminders must be a list of minutes.")
        normalized = []
        for item in value:
            try:
                minutes = int(item)
            except (TypeError, ValueError):
                raise serializers.ValidationError("Every reminder must be a number of minutes.")
            if minutes < 0 or minutes > 525600:
                raise serializers.ValidationError("Reminder is outside the supported range.")
            normalized.append(minutes)
        return sorted(set(normalized), reverse=True)


class CalendarUserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "avatar_url", "user_timezone"]
        read_only_fields = fields


class MeetingParticipantInputSerializer(serializers.Serializer):
    user_id = serializers.UUIDField(required=False, allow_null=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    role = serializers.ChoiceField(choices=MeetingParticipantRole.choices, default=MeetingParticipantRole.REQUIRED)
    source = serializers.ChoiceField(
        choices=MeetingParticipantSource.choices,
        default=MeetingParticipantSource.EXPLICIT,
    )
    source_identifier = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        if not attrs.get("user_id") and not attrs.get("email"):
            raise serializers.ValidationError("Select a user or enter an email address.")
        return attrs


class MeetingParticipantSerializer(BaseSerializer):
    user = CalendarUserSerializer(read_only=True)

    class Meta:
        model = MeetingParticipant
        fields = [
            "id",
            "user",
            "email",
            "name",
            "role",
            "response_status",
            "source",
            "source_identifier",
            "responded_at",
            "removed_at",
        ]
        read_only_fields = fields


class MeetingReminderSerializer(BaseSerializer):
    class Meta:
        model = MeetingReminder
        fields = ["id", "minutes_before", "scheduled_for", "sent_at", "channel"]
        read_only_fields = fields


class MeetingCommentSerializer(BaseSerializer):
    user = CalendarUserSerializer(read_only=True)

    class Meta:
        model = MeetingComment
        fields = ["id", "user", "body", "created_at", "updated_at"]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Comment cannot be empty.")
        return value


class MeetingActivitySerializer(BaseSerializer):
    actor = CalendarUserSerializer(read_only=True)

    class Meta:
        model = MeetingActivity
        fields = ["id", "actor", "event", "details", "created_at"]
        read_only_fields = fields


class MeetingAttachmentSerializer(BaseSerializer):
    asset_id = serializers.UUIDField(source="asset.id", read_only=True)
    name = serializers.SerializerMethodField()
    size = serializers.FloatField(source="asset.size", read_only=True)
    url = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = MeetingAttachment
        fields = [
            "id",
            "asset_id",
            "name",
            "size",
            "shared_with_guests",
            "url",
            "can_delete",
            "created_at",
        ]
        read_only_fields = fields

    def get_name(self, obj):
        return obj.asset.attributes.get("name") or obj.asset.attributes.get("original_name") or "attachment"

    def get_url(self, obj):
        request = self.context.get("request")
        slug = obj.meeting.workspace.slug if obj.meeting.workspace_id else ""
        path = f"/api/workspaces/{slug}/calendar/meetings/{obj.meeting_id}/attachments/{obj.id}/"
        return request.build_absolute_uri(path) if request else path

    def get_can_delete(self, obj):
        request = self.context.get("request")
        return bool(
            request and (obj.created_by_id == request.user.id or meeting_manage_access(request.user, obj.meeting))
        )


class MeetingSerializer(BaseSerializer):
    project_id = serializers.PrimaryKeyRelatedField(
        source="project", queryset=Project.objects.all(), required=False, allow_null=True
    )
    issue_id = serializers.PrimaryKeyRelatedField(
        source="issue", queryset=Issue.unscoped_objects.all(), required=False, allow_null=True
    )
    meeting_type_id = serializers.PrimaryKeyRelatedField(
        source="meeting_type", queryset=MeetingType.objects.all(), required=False, allow_null=True
    )
    organizer = CalendarUserSerializer(read_only=True)
    participants = MeetingParticipantInputSerializer(many=True, write_only=True, required=False)
    participant_details = MeetingParticipantSerializer(source="participants", many=True, read_only=True)
    reminder_minutes = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=525600), write_only=True, required=False
    )
    reminders = MeetingReminderSerializer(many=True, read_only=True)
    comments = MeetingCommentSerializer(many=True, read_only=True)
    activities = MeetingActivitySerializer(many=True, read_only=True)
    attachments = MeetingAttachmentSerializer(many=True, read_only=True)
    detail_access = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_respond = serializers.SerializerMethodField()
    my_response_status = serializers.SerializerMethodField()
    project_identifier = serializers.CharField(source="project.identifier", read_only=True, allow_null=True)
    project_name = serializers.CharField(source="project.name", read_only=True, allow_null=True)
    issue_sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True, allow_null=True)

    class Meta:
        model = Meeting
        fields = [
            "id",
            "workspace_id",
            "project_id",
            "project_identifier",
            "project_name",
            "issue_id",
            "issue_sequence_id",
            "meeting_type_id",
            "organizer",
            "title",
            "description",
            "agenda",
            "starts_at",
            "ends_at",
            "all_day",
            "timezone",
            "location",
            "attendance_mode",
            "meeting_url",
            "meeting_url_source",
            "google_meet_open_access",
            "visibility",
            "availability",
            "status",
            "recurrence_rule",
            "recurrence_timezone",
            "recurrence_until",
            "type_name_snapshot",
            "type_color_snapshot",
            "type_icon_snapshot",
            "task_snapshot",
            "participants",
            "participant_details",
            "reminder_minutes",
            "reminders",
            "comments",
            "activities",
            "attachments",
            "detail_access",
            "can_manage",
            "can_respond",
            "my_response_status",
            "cancelled_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "workspace_id",
            "organizer",
            "type_name_snapshot",
            "type_color_snapshot",
            "type_icon_snapshot",
            "task_snapshot",
            "status",
            "cancelled_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]

    def get_detail_access(self, obj):
        return meeting_detail_access(self.context["request"].user, obj)

    def get_can_manage(self, obj):
        from plane.utils.calendar import meeting_manage_access

        return meeting_manage_access(self.context["request"].user, obj)

    def _current_participant(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        return next(
            (
                participant
                for participant in obj.participants.all()
                if participant.user_id == request.user.id and participant.removed_at is None
            ),
            None,
        )

    def get_can_respond(self, obj):
        return self._current_participant(obj) is not None and obj.status != "CANCELLED"

    def get_my_response_status(self, obj):
        participant = self._current_participant(obj)
        return participant.response_status if participant else None

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise serializers.ValidationError("Unknown timezone.")
        return value

    def validate_recurrence_rule(self, value):
        value = value.strip()
        if value and "FREQ=" not in value.upper():
            raise serializers.ValidationError("Use a valid RFC 5545 recurrence rule.")
        return value

    def validate(self, attrs):
        request = self.context["request"]
        workspace = self.context.get("workspace")
        project = attrs.get("project", getattr(self.instance, "project", None))
        issue = attrs.get("issue", getattr(self.instance, "issue", None))
        meeting_type = attrs.get("meeting_type", getattr(self.instance, "meeting_type", None))
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))

        if not starts_at or not ends_at or ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": "End time must be after start time."})
        all_day = attrs.get("all_day", getattr(self.instance, "all_day", False))
        meeting_timezone = attrs.get("timezone", getattr(self.instance, "timezone", "UTC"))
        if all_day:
            calendar_timezone = ZoneInfo(meeting_timezone)
            if ends_at.astimezone(calendar_timezone).date() <= starts_at.astimezone(calendar_timezone).date():
                raise serializers.ValidationError({"ends_at": "An all-day meeting must end on a later date."})
        if project:
            if not workspace or project.workspace_id != workspace.id:
                raise serializers.ValidationError({"project_id": "Project does not belong to this workspace."})
            if not ProjectMember.objects.filter(project=project, member=request.user, is_active=True).exists():
                raise serializers.ValidationError({"project_id": "You are not an active project member."})
            attrs["visibility"] = attrs.get("visibility") or MeetingVisibility.PROJECT
        else:
            attrs["visibility"] = MeetingVisibility.PERSONAL

        if issue:
            if not project or issue.project_id != project.id:
                raise serializers.ValidationError({"issue_id": "Task does not belong to the selected project."})
            if not can_view_issue(request.user, issue):
                raise serializers.ValidationError({"issue_id": "Task is unavailable."})
        if meeting_type and (not project or meeting_type.project_id != project.id):
            raise serializers.ValidationError({"meeting_type_id": "Meeting type does not belong to this project."})
        if attrs.get("attendance_mode") == "OFFLINE":
            attrs["meeting_url"] = ""
            attrs["meeting_url_source"] = MeetingLinkSource.NONE
        elif attrs.get("meeting_url"):
            attrs["meeting_url_source"] = MeetingLinkSource.MANUAL

        raw_participants = attrs.get("participants")
        if raw_participants is not None:
            user_ids = [item["user_id"] for item in raw_participants if item.get("user_id")]
            users = {
                user.id: user for user in User.objects.filter(id__in=user_ids, is_active=True, blocked_at__isnull=True)
            }
            if set(user_ids) != set(users):
                raise serializers.ValidationError({"participants": "One or more users are inactive or blocked."})
            if project:
                project_user_ids = set(
                    ProjectMember.objects.filter(project=project, member_id__in=user_ids, is_active=True).values_list(
                        "member_id", flat=True
                    )
                )
                if set(user_ids) != project_user_ids:
                    raise serializers.ValidationError(
                        {"participants": "Internal participants must be active project members."}
                    )
            elif workspace:
                workspace_user_ids = set(
                    WorkspaceMember.objects.filter(
                        workspace=workspace,
                        member_id__in=user_ids,
                        is_active=True,
                    ).values_list("member_id", flat=True)
                )
                if set(user_ids) != workspace_user_ids:
                    raise serializers.ValidationError(
                        {"participants": "Internal participants must be active workspace members."}
                    )
            for item in raw_participants:
                item["user"] = users.get(item.get("user_id"))
                item.pop("user_id", None)
        return attrs

    def _sync_reminders(self, meeting, reminder_minutes):
        MeetingReminder.objects.filter(meeting=meeting).delete()
        for minutes in sorted(set(reminder_minutes), reverse=True):
            MeetingReminder.objects.create(
                meeting=meeting,
                minutes_before=minutes,
                scheduled_for=meeting.starts_at - timedelta(minutes=minutes),
            )

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        participants = validated_data.pop("participants", [])
        reminder_minutes = validated_data.pop("reminder_minutes", [])
        issue = validated_data.get("issue")
        meeting_type = validated_data.get("meeting_type")
        if meeting_type:
            validated_data.setdefault("type_name_snapshot", meeting_type.name)
            validated_data.setdefault("type_color_snapshot", meeting_type.color)
            validated_data.setdefault("type_icon_snapshot", meeting_type.icon)
            if not reminder_minutes:
                reminder_minutes = meeting_type.default_reminders
        if issue:
            validated_data["task_snapshot"] = {
                "id": str(issue.id),
                "sequence_id": issue.sequence_id,
                "identifier": issue.project.identifier,
                "title": issue.name,
            }
        if (
            validated_data.get("attendance_mode") in ("ONLINE", "MIXED")
            and not validated_data.get("meeting_url")
            and get_calendar_configuration().get("CALENDAR_GOOGLE_MEET_REFRESH_TOKEN")
        ):
            try:
                meeting_url, space_name = create_open_google_meet()
                if meeting_url:
                    validated_data["meeting_url"] = meeting_url
                    validated_data["google_meet_space"] = space_name
                    validated_data["meeting_url_source"] = MeetingLinkSource.GOOGLE_MEET
            except CalendarProviderError:
                # A meeting must remain creatable when the optional Meet provider is temporarily unavailable.
                pass
        meeting = Meeting.objects.create(
            organizer=request.user,
            workspace=self.context.get("workspace"),
            public_token_hash=opaque_token_hash(),
            **validated_data,
        )
        replace_meeting_participants(meeting, participants, actor=request.user)
        self._sync_reminders(meeting, reminder_minutes)
        MeetingActivity.objects.create(meeting=meeting, actor=request.user, event="CREATED")
        from plane.bgtasks.calendar_notification_task import send_meeting_notifications
        from plane.bgtasks.calendar_task import sync_meeting_to_external_calendars

        transaction.on_commit(
            lambda: (
                send_meeting_notifications.delay(str(meeting.id), "CREATED"),
                sync_meeting_to_external_calendars.delay(str(meeting.id)),
            )
        )
        return meeting

    @transaction.atomic
    def update(self, instance, validated_data):
        request = self.context["request"]
        participants = validated_data.pop("participants", None)
        reminder_minutes = validated_data.pop("reminder_minutes", None)
        changed = {}
        for field, value in validated_data.items():
            old_value = getattr(instance, field)
            old_comparable = getattr(old_value, "id", old_value)
            new_comparable = getattr(value, "id", value)
            if old_comparable != new_comparable:
                changed[field] = {"from": str(old_comparable), "to": str(new_comparable)}
            setattr(instance, field, value)
        instance.save()
        if participants is not None:
            replace_meeting_participants(instance, participants, actor=request.user)
            changed["participants"] = True
        if reminder_minutes is not None:
            self._sync_reminders(instance, reminder_minutes)
            changed["reminders"] = True
        if changed:
            MeetingActivity.objects.create(meeting=instance, actor=request.user, event="UPDATED", details=changed)
            from plane.bgtasks.calendar_notification_task import send_meeting_notifications
            from plane.bgtasks.calendar_task import sync_meeting_to_external_calendars

            transaction.on_commit(
                lambda: (
                    send_meeting_notifications.delay(
                        str(instance.id),
                        "UPDATED",
                        changes=changed,
                        actor_id=str(request.user.id),
                    ),
                    sync_meeting_to_external_calendars.delay(str(instance.id)),
                )
            )
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["detail_access"]:
            for field in [
                "description",
                "agenda",
                "location",
                "meeting_url",
                "participant_details",
                "reminders",
                "comments",
                "activities",
                "attachments",
                "task_snapshot",
                "issue_id",
                "issue_sequence_id",
            ]:
                data.pop(field, None)
        return data


class WorkspaceCalendarSettingsSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceCalendarSettings
        fields = [
            "id",
            "country_code",
            "working_hours",
            "holiday_sync_enabled",
            "holiday_source_url",
            "holiday_last_synced_at",
            "holiday_last_error",
            "updated_at",
        ]
        read_only_fields = ["id", "holiday_last_synced_at", "holiday_last_error", "updated_at"]

    def validate_country_code(self, value):
        value = value.upper()
        if len(value) != 2:
            raise serializers.ValidationError("Use a two-letter country code.")
        return value

    def validate_working_hours(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Working hours must contain seven weekdays.")
        for day in range(1, 8):
            item = value.get(str(day))
            if not isinstance(item, dict) or "enabled" not in item:
                raise serializers.ValidationError(f"Working hours for weekday {day} are missing.")
            if item["enabled"] and (not item.get("start") or not item.get("end") or item["end"] <= item["start"]):
                raise serializers.ValidationError(f"Working hours for weekday {day} are invalid.")
        return value


class WorkspaceHolidaySerializer(BaseSerializer):
    class Meta:
        model = WorkspaceHoliday
        fields = [
            "id",
            "date",
            "name",
            "kind",
            "source",
            "source_key",
            "is_override",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "source_key", "created_at", "updated_at"]


class CalendarPreferenceSerializer(BaseSerializer):
    class Meta:
        model = CalendarPreference
        fields = [
            "id",
            "default_view",
            "filters",
            "external_routing",
            "default_reminders",
            "working_hours",
            "show_weekends",
            "email_notifications_enabled",
            "in_app_notifications_enabled",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]


class CalendarConnectionSerializer(BaseSerializer):
    server_url = serializers.URLField(write_only=True, required=False, allow_blank=True)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    app_password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    has_credentials = serializers.SerializerMethodField()

    class Meta:
        model = CalendarConnection
        fields = [
            "id",
            "provider",
            "account_email",
            "account_label",
            "status",
            "selected_calendars",
            "is_gts_target",
            "gts_calendar_id",
            "gts_calendar_last_error",
            "sync_mode",
            "last_synced_at",
            "last_error_at",
            "last_error",
            "has_credentials",
            "server_url",
            "username",
            "app_password",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "is_gts_target",
            "gts_calendar_id",
            "gts_calendar_last_error",
            "last_synced_at",
            "last_error_at",
            "last_error",
            "has_credentials",
            "created_at",
            "updated_at",
        ]

    def get_has_credentials(self, obj):
        return bool(obj.credentials_encrypted)

    def validate(self, attrs):
        provider = attrs.get("provider", getattr(self.instance, "provider", None))
        if provider in ["ICLOUD", "CALDAV"] and not self.instance:
            missing = [field for field in ("server_url", "username", "app_password") if not attrs.get(field)]
            if missing:
                raise serializers.ValidationError({field: "This field is required." for field in missing})
        return attrs

    def _encrypt_credentials(self, validated_data):
        import json

        server_url = validated_data.pop("server_url", "")
        username = validated_data.pop("username", "")
        password = validated_data.pop("app_password", "")
        if server_url:
            validated_data["server_url_encrypted"] = encrypt_data(server_url)
        if username or password:
            validated_data["credentials_encrypted"] = encrypt_data(
                json.dumps({"username": username, "app_password": password})
            )
        return validated_data

    def create(self, validated_data):
        validated_data = self._encrypt_credentials(validated_data)
        return CalendarConnection.objects.create(user=self.context["request"].user, **validated_data)

    def update(self, instance, validated_data):
        validated_data = self._encrypt_credentials(validated_data)
        return super().update(instance, validated_data)
