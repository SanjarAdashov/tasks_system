from django.urls import path

from plane.app.views import (
    CalendarAvailabilityEndpoint,
    CalendarConnectionViewSet,
    CalendarOAuthCallbackEndpoint,
    CalendarOAuthStartEndpoint,
    CalendarPreferenceEndpoint,
    IssueMeetingDefaultsEndpoint,
    MeetingCommentViewSet,
    MeetingAttachmentViewSet,
    MeetingICSEndpoint,
    MeetingTypeViewSet,
    MeetingViewSet,
    PublicMeetingResponseEndpoint,
    PublicMeetingAttachmentEndpoint,
    WorkspaceCalendarSettingsEndpoint,
    WorkspaceHolidayViewSet,
    WorkspaceHolidaySyncEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/calendar/meetings/",
        MeetingViewSet.as_view({"get": "list", "post": "create"}),
        name="calendar-meetings",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/",
        MeetingViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="calendar-meeting-detail",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/cancel/",
        MeetingViewSet.as_view({"post": "cancel"}),
        name="calendar-meeting-cancel",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/transfer/",
        MeetingViewSet.as_view({"post": "transfer"}),
        name="calendar-meeting-transfer",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/response/",
        MeetingViewSet.as_view({"post": "respond"}),
        name="calendar-meeting-response",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/occurrence/",
        MeetingViewSet.as_view({"post": "occurrence"}),
        name="calendar-meeting-occurrence",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:pk>/ics/",
        MeetingICSEndpoint.as_view(),
        name="calendar-meeting-ics",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:meeting_id>/comments/",
        MeetingCommentViewSet.as_view({"get": "list", "post": "create"}),
        name="calendar-meeting-comments",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:meeting_id>/attachments/",
        MeetingAttachmentViewSet.as_view(),
        name="calendar-meeting-attachments",
    ),
    path(
        "workspaces/<str:slug>/calendar/meetings/<uuid:meeting_id>/attachments/<uuid:pk>/",
        MeetingAttachmentViewSet.as_view(),
        name="calendar-meeting-attachment-detail",
    ),
    path(
        "workspaces/<str:slug>/calendar/availability/",
        CalendarAvailabilityEndpoint.as_view(),
        name="calendar-availability",
    ),
    path(
        "workspaces/<str:slug>/calendar/settings/",
        WorkspaceCalendarSettingsEndpoint.as_view(),
        name="workspace-calendar-settings",
    ),
    path(
        "workspaces/<str:slug>/calendar/holidays/",
        WorkspaceHolidayViewSet.as_view({"get": "list", "post": "create"}),
        name="workspace-calendar-holidays",
    ),
    path(
        "workspaces/<str:slug>/calendar/holidays/sync/",
        WorkspaceHolidaySyncEndpoint.as_view(),
        name="workspace-calendar-holidays-sync",
    ),
    path(
        "workspaces/<str:slug>/calendar/holidays/<uuid:pk>/",
        WorkspaceHolidayViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="workspace-calendar-holiday-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/meeting-types/",
        MeetingTypeViewSet.as_view({"get": "list", "post": "create"}),
        name="project-meeting-types",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/meeting-types/reorder/",
        MeetingTypeViewSet.as_view({"post": "reorder"}),
        name="project-meeting-types-reorder",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/meeting-types/<uuid:pk>/",
        MeetingTypeViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="project-meeting-type-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/meeting-defaults/",
        IssueMeetingDefaultsEndpoint.as_view(),
        name="issue-meeting-defaults",
    ),
    path("users/me/calendar/preferences/", CalendarPreferenceEndpoint.as_view(), name="calendar-preferences"),
    path(
        "users/me/calendar/connections/",
        CalendarConnectionViewSet.as_view({"get": "list", "post": "create"}),
        name="calendar-connections",
    ),
    path(
        "users/me/calendar/connections/oauth/start/",
        CalendarOAuthStartEndpoint.as_view(),
        name="calendar-oauth-start",
    ),
    path(
        "users/me/calendar/connections/oauth/callback/",
        CalendarOAuthCallbackEndpoint.as_view(),
        name="calendar-oauth-callback",
    ),
    path(
        "users/me/calendar/connections/<uuid:pk>/",
        CalendarConnectionViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="calendar-connection-detail",
    ),
    path(
        "users/me/calendar/connections/<uuid:pk>/resync/",
        CalendarConnectionViewSet.as_view({"post": "resync"}),
        name="calendar-connection-resync",
    ),
    path(
        "users/me/calendar/connections/<uuid:pk>/calendars/",
        CalendarConnectionViewSet.as_view({"get": "calendars"}),
        name="calendar-connection-calendars",
    ),
    path(
        "calendar/public/respond/<str:token>/",
        PublicMeetingResponseEndpoint.as_view(),
        name="calendar-public-response",
    ),
    path(
        "calendar/public/respond/<str:token>/attachments/<uuid:pk>/",
        PublicMeetingAttachmentEndpoint.as_view(),
        name="calendar-public-attachment",
    ),
]
