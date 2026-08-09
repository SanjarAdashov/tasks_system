# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from plane.space.views import (
    PublicIntakeAssetDownloadEndpoint,
    PublicIntakeAssetEndpoint,
    PublicIntakeFormEndpoint,
    PublicIntakeTrackingEndpoint,
    PublicIntakeTrackingAssetEndpoint,
)


urlpatterns = [
    path("support/forms/<slug:form_slug>/", PublicIntakeFormEndpoint.as_view(), name="public-intake-form"),
    path("support/forms/<slug:form_slug>/assets/", PublicIntakeAssetEndpoint.as_view(), name="public-intake-asset"),
    path(
        "support/forms/<slug:form_slug>/assets/<uuid:asset_id>/",
        PublicIntakeAssetEndpoint.as_view(),
        name="public-intake-asset-detail",
    ),
    path(
        "support/status/<str:tracking_token>/",
        PublicIntakeTrackingEndpoint.as_view(),
        name="public-intake-tracking",
    ),
    path(
        "support/status/<str:tracking_token>/assets/",
        PublicIntakeTrackingAssetEndpoint.as_view(),
        name="public-intake-tracking-asset",
    ),
    path(
        "support/status/<str:tracking_token>/assets/<uuid:asset_id>/upload/",
        PublicIntakeTrackingAssetEndpoint.as_view(),
        name="public-intake-tracking-asset-detail",
    ),
    path(
        "support/status/<str:tracking_token>/assets/<uuid:asset_id>/",
        PublicIntakeAssetDownloadEndpoint.as_view(),
        name="public-intake-asset-download",
    ),
]
