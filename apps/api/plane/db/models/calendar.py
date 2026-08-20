# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .base import BaseModel


def get_default_working_hours():
    """Default Monday-Friday schedule in the user's own timezone."""
    return {str(day): {"enabled": day <= 5, "start": "08:00", "end": "22:00"} for day in range(1, 8)}


def get_default_calendar_filters():
    return {
        "project_id": "",
        "organizer_id": "",
        "show_cancelled": False,
        "show_external": True,
    }


class MeetingVisibility(models.TextChoices):
    PROJECT = "PROJECT", "Project"
    RESTRICTED = "RESTRICTED", "Restricted"
    PERSONAL = "PERSONAL", "Personal"


class MeetingStatus(models.TextChoices):
    PLANNED = "PLANNED", "Planned"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class MeetingAttendanceMode(models.TextChoices):
    ONLINE = "ONLINE", "Online"
    OFFLINE = "OFFLINE", "Offline"
    MIXED = "MIXED", "Mixed"


class MeetingAvailability(models.TextChoices):
    BUSY = "BUSY", "Busy"
    FREE = "FREE", "Free"
    MAYBE = "MAYBE", "Maybe"
    AWAY = "AWAY", "Away"


class MeetingLinkSource(models.TextChoices):
    NONE = "NONE", "None"
    MANUAL = "MANUAL", "Manual"
    GOOGLE_MEET = "GOOGLE_MEET", "Google Meet"


class MeetingParticipantRole(models.TextChoices):
    REQUIRED = "REQUIRED", "Required"
    OPTIONAL = "OPTIONAL", "Optional"


class MeetingResponseStatus(models.TextChoices):
    NO_RESPONSE = "NO_RESPONSE", "No response"
    ACCEPTED = "ACCEPTED", "Accepted"
    TENTATIVE = "TENTATIVE", "Tentative"
    DECLINED = "DECLINED", "Declined"


class MeetingParticipantSource(models.TextChoices):
    ORGANIZER = "ORGANIZER", "Organizer"
    EXPLICIT = "EXPLICIT", "Explicit"
    TASK_CREATOR = "TASK_CREATOR", "Task creator"
    TASK_ASSIGNEE = "TASK_ASSIGNEE", "Task assignee"
    TASK_PROPERTY = "TASK_PROPERTY", "Task member property"
    TASK_SUBSCRIBER = "TASK_SUBSCRIBER", "Task subscriber"
    TASK_GROUP = "TASK_GROUP", "Task access group"


class CalendarProvider(models.TextChoices):
    GOOGLE = "GOOGLE", "Google Calendar"
    MICROSOFT = "MICROSOFT", "Microsoft Outlook"
    ICLOUD = "ICLOUD", "iCloud"
    CALDAV = "CALDAV", "CalDAV"


class CalendarSyncMode(models.TextChoices):
    FULL = "FULL", "Bidirectional"
    INBOUND_BUSY = "INBOUND_BUSY", "Inbound busy only"
    OUTBOUND_GTS = "OUTBOUND_GTS", "GTS outbound only"
    DISABLED = "DISABLED", "Disabled"


class CalendarConnectionStatus(models.TextChoices):
    CONNECTED = "CONNECTED", "Connected"
    PARTIAL = "PARTIAL", "Partially synchronized"
    PAUSED = "PAUSED", "Paused"
    ERROR = "ERROR", "Error"


class WorkspaceCalendarSettings(BaseModel):
    workspace = models.OneToOneField(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="calendar_settings",
    )
    country_code = models.CharField(max_length=2, default="UZ")
    working_hours = models.JSONField(default=get_default_working_hours)
    holiday_sync_enabled = models.BooleanField(default=True)
    holiday_source_url = models.URLField(max_length=800, default="https://my.gov.uz/ru/day-off")
    holiday_last_synced_at = models.DateTimeField(null=True, blank=True)
    holiday_last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "workspace_calendar_settings"


class WorkspaceHoliday(BaseModel):
    class Kind(models.TextChoices):
        HOLIDAY = "HOLIDAY", "Official holiday"
        DAY_OFF = "DAY_OFF", "Day off"
        WORKDAY = "WORKDAY", "Working day"

    class Source(models.TextChoices):
        MY_GOV = "MY_GOV", "my.gov.uz"
        MANUAL = "MANUAL", "Manual override"
        CORPORATE = "CORPORATE", "Corporate"

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="calendar_holidays",
    )
    date = models.DateField()
    name = models.CharField(max_length=255, blank=True, default="")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MY_GOV)
    source_key = models.CharField(max_length=255, blank=True, default="")
    source_payload = models.JSONField(default=dict, blank=True)
    is_override = models.BooleanField(default=False)

    class Meta:
        db_table = "workspace_holidays"
        ordering = ("date",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "date", "source"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_workspace_holiday_source",
            )
        ]
        indexes = [models.Index(fields=["workspace", "date"], name="workspace_holiday_date_idx")]


class BirthdayNotificationDelivery(BaseModel):
    class DeliveryType(models.TextChoices):
        ADVANCE_IN_APP = "ADVANCE_IN_APP", "Advance in-app notification"
        ADVANCE_EMAIL = "ADVANCE_EMAIL", "Advance email notification"
        ADVANCE_TELEGRAM = "ADVANCE_TELEGRAM", "Advance Telegram notification"
        SELF_EMAIL = "SELF_EMAIL", "Birthday email greeting"
        SELF_TELEGRAM = "SELF_TELEGRAM", "Birthday Telegram greeting"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="birthday_notifications_received",
    )
    birthday_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="birthday_notifications_about",
    )
    occurrence_year = models.PositiveSmallIntegerField()
    delivery_type = models.CharField(max_length=32, choices=DeliveryType.choices)
    delivered_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "birthday_notification_deliveries"
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "birthday_user", "occurrence_year", "delivery_type"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_birthday_delivery",
            )
        ]
        indexes = [
            models.Index(
                fields=["birthday_user", "occurrence_year"],
                name="bday_delivery_occurrence_idx",
            )
        ]


class MeetingType(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="meeting_types",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="meeting_types",
    )
    name = models.CharField(max_length=120)
    color = models.CharField(max_length=16, default="#22C55E")
    icon = models.CharField(max_length=64, default="calendar")
    default_duration_minutes = models.PositiveIntegerField(default=30)
    default_reminders = models.JSONField(default=list, blank=True)
    default_attendance_mode = models.CharField(
        max_length=16,
        choices=MeetingAttendanceMode.choices,
        default=MeetingAttendanceMode.ONLINE,
    )
    is_default = models.BooleanField(default=False)
    sort_order = models.FloatField(default=65535)

    class Meta:
        db_table = "meeting_types"
        ordering = ("sort_order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_project_meeting_type_name",
            ),
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(is_default=True, deleted_at__isnull=True),
                name="unique_default_project_meeting_type",
            ),
        ]


class CalendarPreference(BaseModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="calendar_preference",
    )
    default_view = models.CharField(max_length=16, default="MONTH")
    filters = models.JSONField(default=get_default_calendar_filters)
    external_routing = models.JSONField(default=dict, blank=True)
    default_reminders = models.JSONField(default=list, blank=True)
    working_hours = models.JSONField(default=get_default_working_hours)
    show_weekends = models.BooleanField(default=True)
    email_notifications_enabled = models.BooleanField(default=True)
    in_app_notifications_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "calendar_preferences"


class Meeting(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.SET_NULL,
        related_name="meetings",
        null=True,
        blank=True,
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.SET_NULL,
        related_name="meetings",
        null=True,
        blank=True,
    )
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.SET_NULL,
        related_name="meetings",
        null=True,
        blank=True,
    )
    meeting_type = models.ForeignKey(
        MeetingType,
        on_delete=models.SET_NULL,
        related_name="meetings",
        null=True,
        blank=True,
    )
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organized_meetings",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    agenda = models.TextField(blank=True, default="")
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(db_index=True)
    all_day = models.BooleanField(default=False)
    timezone = models.CharField(max_length=255, default="UTC")
    location = models.CharField(max_length=500, blank=True, default="")
    attendance_mode = models.CharField(
        max_length=16,
        choices=MeetingAttendanceMode.choices,
        default=MeetingAttendanceMode.ONLINE,
    )
    meeting_url = models.URLField(max_length=1000, blank=True, default="")
    meeting_url_source = models.CharField(
        max_length=16,
        choices=MeetingLinkSource.choices,
        default=MeetingLinkSource.NONE,
    )
    google_meet_space = models.CharField(max_length=255, blank=True, default="")
    google_meet_open_access = models.BooleanField(default=True)
    visibility = models.CharField(
        max_length=16,
        choices=MeetingVisibility.choices,
        default=MeetingVisibility.PROJECT,
        db_index=True,
    )
    availability = models.CharField(
        max_length=16,
        choices=MeetingAvailability.choices,
        default=MeetingAvailability.BUSY,
    )
    status = models.CharField(
        max_length=16,
        choices=MeetingStatus.choices,
        default=MeetingStatus.PLANNED,
        db_index=True,
    )
    recurrence_rule = models.TextField(blank=True, default="")
    recurrence_timezone = models.CharField(max_length=255, blank=True, default="")
    recurrence_until = models.DateTimeField(null=True, blank=True)
    type_name_snapshot = models.CharField(max_length=120, blank=True, default="")
    type_color_snapshot = models.CharField(max_length=16, blank=True, default="")
    type_icon_snapshot = models.CharField(max_length=64, blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    task_snapshot = models.JSONField(default=dict, blank=True)
    public_token_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        db_table = "meetings"
        ordering = ("starts_at",)
        indexes = [
            models.Index(fields=["organizer", "starts_at"], name="meeting_organizer_start_idx"),
            models.Index(fields=["workspace", "starts_at", "ends_at"], name="meeting_workspace_range_idx"),
            models.Index(fields=["project", "starts_at", "ends_at"], name="meeting_project_range_idx"),
            models.Index(fields=["issue", "starts_at"], name="meeting_issue_start_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.project_id:
            self.workspace_id = self.project.workspace_id
        if self.meeting_type_id and not self.type_name_snapshot:
            self.type_name_snapshot = self.meeting_type.name
            self.type_color_snapshot = self.meeting_type.color
            self.type_icon_snapshot = self.meeting_type.icon
        super().save(*args, **kwargs)


class MeetingParticipant(BaseModel):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="meeting_participations",
        null=True,
        blank=True,
    )
    email = models.EmailField(max_length=255)
    name = models.CharField(max_length=255, blank=True, default="")
    role = models.CharField(
        max_length=16,
        choices=MeetingParticipantRole.choices,
        default=MeetingParticipantRole.REQUIRED,
    )
    response_status = models.CharField(
        max_length=16,
        choices=MeetingResponseStatus.choices,
        default=MeetingResponseStatus.NO_RESPONSE,
    )
    source = models.CharField(
        max_length=24,
        choices=MeetingParticipantSource.choices,
        default=MeetingParticipantSource.EXPLICIT,
    )
    source_identifier = models.UUIDField(null=True, blank=True)
    response_token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    removed_at = models.DateTimeField(null=True, blank=True)
    notify_by_email = models.BooleanField(default=True)

    class Meta:
        db_table = "meeting_participants"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["meeting", "user"],
                condition=Q(user__isnull=False, deleted_at__isnull=True),
                name="unique_active_meeting_user_participant",
            ),
            models.UniqueConstraint(
                fields=["meeting", "email"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_meeting_email_participant",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "response_status"], name="meeting_participant_user_idx"),
            models.Index(fields=["meeting", "removed_at"], name="meeting_participant_active_idx"),
        ]


class MeetingReminder(BaseModel):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="reminders")
    participant = models.ForeignKey(
        MeetingParticipant,
        on_delete=models.CASCADE,
        related_name="reminders",
        null=True,
        blank=True,
    )
    minutes_before = models.PositiveIntegerField()
    scheduled_for = models.DateTimeField(db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    channel = models.CharField(max_length=16, default="IN_APP")

    class Meta:
        db_table = "meeting_reminders"
        indexes = [models.Index(fields=["sent_at", "scheduled_for"], name="meeting_reminder_due_idx")]


class MeetingRecurrenceException(BaseModel):
    class Action(models.TextChoices):
        UPDATED = "UPDATED", "Updated"
        CANCELLED = "CANCELLED", "Cancelled"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="recurrence_exceptions")
    original_starts_at = models.DateTimeField()
    action = models.CharField(max_length=16, choices=Action.choices)
    overrides = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "meeting_recurrence_exceptions"
        constraints = [
            models.UniqueConstraint(
                fields=["meeting", "original_starts_at"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_meeting_recurrence_exception",
            )
        ]


class MeetingComment(BaseModel):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="meeting_comments",
        null=True,
    )
    body = models.TextField()

    class Meta:
        db_table = "meeting_comments"
        ordering = ("created_at",)


class MeetingActivity(BaseModel):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="meeting_activities",
        null=True,
    )
    event = models.CharField(max_length=64)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "meeting_activities"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["meeting", "created_at"], name="meeting_activity_time_idx")]


class MeetingAttachment(BaseModel):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="attachments")
    asset = models.OneToOneField(
        "db.FileAsset",
        on_delete=models.CASCADE,
        related_name="meeting_attachment",
    )
    shared_with_guests = models.BooleanField(default=False)

    class Meta:
        db_table = "meeting_attachments"


class CalendarConnection(BaseModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="calendar_connections",
    )
    provider = models.CharField(max_length=16, choices=CalendarProvider.choices)
    account_email = models.EmailField(max_length=255, blank=True, default="")
    account_label = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=CalendarConnectionStatus.choices,
        default=CalendarConnectionStatus.CONNECTED,
    )
    credentials_encrypted = models.TextField(blank=True, default="")
    server_url_encrypted = models.TextField(blank=True, default="")
    selected_calendars = models.JSONField(default=list, blank=True)
    sync_mode = models.CharField(
        max_length=24,
        choices=CalendarSyncMode.choices,
        default=CalendarSyncMode.FULL,
    )
    sync_token_encrypted = models.TextField(blank=True, default="")
    webhook_channel_id = models.CharField(max_length=255, blank=True, default="")
    webhook_expires_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "calendar_connections"
        ordering = ("provider", "account_email")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "provider", "account_email"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_user_calendar_connection",
            )
        ]


class MeetingExternalEvent(BaseModel):
    meeting = models.ForeignKey(
        Meeting,
        on_delete=models.CASCADE,
        related_name="external_events",
        null=True,
        blank=True,
    )
    connection = models.ForeignKey(
        CalendarConnection,
        on_delete=models.CASCADE,
        related_name="external_events",
    )
    provider_event_id = models.CharField(max_length=512)
    provider_calendar_id = models.CharField(max_length=512, blank=True, default="")
    title = models.CharField(max_length=255, blank=True, default="")
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(db_index=True)
    all_day = models.BooleanField(default=False)
    availability = models.CharField(
        max_length=16,
        choices=MeetingAvailability.choices,
        default=MeetingAvailability.BUSY,
    )
    provider_updated_at = models.DateTimeField(null=True, blank=True)
    etag = models.CharField(max_length=512, blank=True, default="")
    raw_payload_encrypted = models.TextField(blank=True, default="")
    is_deleted_at_provider = models.BooleanField(default=False)

    class Meta:
        db_table = "meeting_external_events"
        constraints = [
            models.UniqueConstraint(
                fields=["connection", "provider_calendar_id", "provider_event_id"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_calendar_external_event",
            )
        ]
        indexes = [models.Index(fields=["connection", "starts_at", "ends_at"], name="external_event_range_idx")]
