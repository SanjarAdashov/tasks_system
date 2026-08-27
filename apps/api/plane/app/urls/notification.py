# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path


from plane.app.views import (
    NotificationViewSet,
    UnreadNotificationEndpoint,
    MarkAllReadNotificationViewSet,
    UserNotificationPreferenceEndpoint,
    TelegramDisconnectEndpoint,
    TelegramLinkEndpoint,
    TelegramMiniAppAccessEndpoint,
    TelegramMiniAppSessionEndpoint,
    TelegramNotificationPreferenceEndpoint,
    TelegramWebhookEndpoint,
    ProjectAnnouncementAttachmentEndpoint,
    ProjectAnnouncementUserEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/users/notifications/",
        NotificationViewSet.as_view({"get": "list"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/",
        NotificationViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/read/",
        NotificationViewSet.as_view({"post": "mark_read", "delete": "mark_unread"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/archive/",
        NotificationViewSet.as_view({"post": "archive", "delete": "unarchive"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/unread/",
        UnreadNotificationEndpoint.as_view(),
        name="unread-notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/mark-all-read/",
        MarkAllReadNotificationViewSet.as_view({"post": "create"}),
        name="mark-all-read-notifications",
    ),
    path(
        "users/me/notification-preferences/",
        UserNotificationPreferenceEndpoint.as_view(),
        name="user-notification-preferences",
    ),
    path(
        "workspaces/<str:slug>/users/project-announcements/important/",
        ProjectAnnouncementUserEndpoint.as_view(),
        name="important-project-announcements",
    ),
    path(
        "workspaces/<str:slug>/users/project-announcements/<uuid:pk>/",
        ProjectAnnouncementUserEndpoint.as_view(),
        name="project-announcement-detail",
    ),
    path(
        "workspaces/<str:slug>/users/project-announcements/<uuid:pk>/dismiss/",
        ProjectAnnouncementUserEndpoint.as_view(),
        name="project-announcement-dismiss",
    ),
    path(
        "workspaces/<str:slug>/project-announcements/<uuid:announcement_id>/attachments/<uuid:pk>/",
        ProjectAnnouncementAttachmentEndpoint.as_view(),
        name="project-announcement-attachment",
    ),
    path("users/me/telegram/", TelegramNotificationPreferenceEndpoint.as_view(), name="telegram-preferences"),
    path("users/me/telegram/link/", TelegramLinkEndpoint.as_view(), name="telegram-link"),
    path(
        "users/me/telegram/disconnect/",
        TelegramDisconnectEndpoint.as_view(),
        name="telegram-disconnect",
    ),
    path(
        "telegram/mini-app/session/",
        TelegramMiniAppSessionEndpoint.as_view(),
        name="telegram-mini-app-session",
    ),
    path(
        "telegram/mini-app/access/",
        TelegramMiniAppAccessEndpoint.as_view(),
        name="telegram-mini-app-access",
    ),
    path("telegram/webhook/", TelegramWebhookEndpoint.as_view(), name="telegram-webhook"),
]
