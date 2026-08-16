# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.license.api.views import (
    EmailCredentialCheckEndpoint,
    InstanceAdminEndpoint,
    InstanceAdminSignInEndpoint,
    InstanceAdminSignUpEndpoint,
    InstanceConfigurationEndpoint,
    DisableEmailFeatureEndpoint,
    InstanceEndpoint,
    SignUpScreenVisitedEndpoint,
    InstanceAdminUserMeEndpoint,
    InstanceAdminSignOutEndpoint,
    InstanceAdminUserSessionEndpoint,
    InstanceWorkSpaceAvailabilityCheckEndpoint,
    InstanceWorkSpaceEndpoint,
    InstanceUserEndpoint,
    InstanceUserBlockEndpoint,
    InstanceUserCreationQuotaEndpoint,
    InstanceProjectUserGroupContextEndpoint,
    InstanceUserUnblockEndpoint,
    InstanceThemeApplyEndpoint,
    InstanceThemeBackgroundAssetEndpoint,
    InstanceTelegramConnectionDisconnectEndpoint,
    InstanceTelegramConnectionEndpoint,
    InstanceTelegramEndpoint,
    InstanceTelegramTestEndpoint,
)

urlpatterns = [
    path("", InstanceEndpoint.as_view(), name="instance"),
    path("admins/", InstanceAdminEndpoint.as_view(), name="instance-admins"),
    path("admins/me/", InstanceAdminUserMeEndpoint.as_view(), name="instance-admins"),
    path(
        "admins/session/",
        InstanceAdminUserSessionEndpoint.as_view(),
        name="instance-admin-session",
    ),
    path(
        "admins/sign-out/",
        InstanceAdminSignOutEndpoint.as_view(),
        name="instance-admins",
    ),
    path("admins/<uuid:pk>/", InstanceAdminEndpoint.as_view(), name="instance-admins"),
    path(
        "configurations/",
        InstanceConfigurationEndpoint.as_view(),
        name="instance-configuration",
    ),
    path(
        "configurations/disable-email-feature/",
        DisableEmailFeatureEndpoint.as_view(),
        name="disable-email-configuration",
    ),
    path(
        "admins/sign-in/",
        InstanceAdminSignInEndpoint.as_view(),
        name="instance-admin-sign-in",
    ),
    path(
        "admins/sign-up/",
        InstanceAdminSignUpEndpoint.as_view(),
        name="instance-admin-sign-in",
    ),
    path(
        "admins/sign-up-screen-visited/",
        SignUpScreenVisitedEndpoint.as_view(),
        name="instance-sign-up",
    ),
    path(
        "email-credentials-check/",
        EmailCredentialCheckEndpoint.as_view(),
        name="email-credential-check",
    ),
    path(
        "workspace-slug-check/",
        InstanceWorkSpaceAvailabilityCheckEndpoint.as_view(),
        name="instance-workspace-availability",
    ),
    path("workspaces/", InstanceWorkSpaceEndpoint.as_view(), name="instance-workspace"),
    path("users/", InstanceUserEndpoint.as_view(), name="instance-users"),
    path(
        "users/<uuid:user_id>/block/",
        InstanceUserBlockEndpoint.as_view(),
        name="instance-user-block",
    ),
    path(
        "users/<uuid:user_id>/unblock/",
        InstanceUserUnblockEndpoint.as_view(),
        name="instance-user-unblock",
    ),
    path(
        "users/<uuid:user_id>/creation-quotas/",
        InstanceUserCreationQuotaEndpoint.as_view(),
        name="instance-user-creation-quotas",
    ),
    path(
        "project-user-groups/",
        InstanceProjectUserGroupContextEndpoint.as_view(),
        name="instance-project-user-groups",
    ),
    path(
        "interface-theme/apply/",
        InstanceThemeApplyEndpoint.as_view(),
        name="instance-interface-theme-apply",
    ),
    path(
        "interface-theme/background/",
        InstanceThemeBackgroundAssetEndpoint.as_view(),
        name="instance-interface-theme-background",
    ),
    path(
        "interface-theme/background/<uuid:asset_id>/",
        InstanceThemeBackgroundAssetEndpoint.as_view(),
        name="instance-interface-theme-background-detail",
    ),
    path("telegram/", InstanceTelegramEndpoint.as_view(), name="instance-telegram"),
    path("telegram/test/", InstanceTelegramTestEndpoint.as_view(), name="instance-telegram-test"),
    path(
        "telegram/connections/",
        InstanceTelegramConnectionEndpoint.as_view(),
        name="instance-telegram-connections",
    ),
    path(
        "telegram/connections/<uuid:connection_id>/",
        InstanceTelegramConnectionDisconnectEndpoint.as_view(),
        name="instance-telegram-connection-disconnect",
    ),
]
