# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re
import uuid

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from .base import BaseAPIView
from plane.db.models import FileAsset, Profile
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.models import InstanceConfiguration
from plane.settings.storage import S3Storage
from plane.utils.attachments import validate_attachment_size
from plane.utils.cache import invalidate_cache
from plane.utils.path_validator import sanitize_filename


ALLOWED_INTERFACE_THEMES = {
    "light",
    "dark",
    "light-contrast",
    "dark-contrast",
    "gts-glass-dark",
}
ALLOWED_GLASS_BACKGROUNDS = {"gts-tasks", "custom", "none"}
ALLOWED_BACKGROUND_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
STATIC_ASSET_PATTERN = re.compile(r"^/api/assets/v2/static/([0-9a-fA-F-]{36})/$")


def _validated_optional_opacity(data, key, label, minimum, maximum):
    if key not in data:
        return None

    try:
        value = int(data.get(key))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}.")
    return value


def _validated_theme_settings(data):
    theme = str(data.get("theme", "")).strip()
    if theme not in ALLOWED_INTERFACE_THEMES:
        raise ValueError("Unsupported interface theme.")

    accent_color = str(data.get("glass_accent_color", "")).strip().upper()
    if not HEX_COLOR_PATTERN.fullmatch(accent_color):
        raise ValueError("Accent color must be a 6-digit HEX value.")

    background = str(data.get("glass_background", "")).strip()
    if background not in ALLOWED_GLASS_BACKGROUNDS:
        raise ValueError("Unsupported glass background.")

    background_url = str(data.get("glass_background_url", "") or "").strip()
    if background == "custom":
        asset_match = STATIC_ASSET_PATTERN.fullmatch(background_url)
        if not asset_match:
            raise ValueError("Select an uploaded background image.")
        if not FileAsset.objects.filter(
            id=asset_match.group(1),
            entity_type=FileAsset.EntityTypeContext.INSTANCE_BACKGROUND,
            is_uploaded=True,
            is_deleted=False,
        ).exists():
            raise ValueError("The selected background image is unavailable.")
    else:
        background_url = ""

    try:
        overlay_opacity = int(data.get("glass_overlay_opacity", 46))
    except (TypeError, ValueError) as exc:
        raise ValueError("Background dimming must be a number.") from exc
    if overlay_opacity < 42 or overlay_opacity > 58:
        raise ValueError("Background dimming must be between 42 and 58.")

    workspace_opacity = _validated_optional_opacity(
        data,
        "glass_workspace_opacity",
        "Main window opacity",
        10,
        80,
    )
    task_opacity = _validated_optional_opacity(
        data,
        "glass_task_opacity",
        "Task card opacity",
        10,
        95,
    )

    return {
        "theme": theme,
        "glass_accent_color": accent_color,
        "glass_background": background,
        "glass_background_url": background_url,
        "glass_overlay_opacity": overlay_opacity,
        "glass_workspace_opacity": workspace_opacity,
        "glass_task_opacity": task_opacity,
    }


class InstanceThemeBackgroundAssetEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request):
        name = sanitize_filename(request.data.get("name")) or "instance-background"
        mime_type = str(request.data.get("type", "")).strip().lower()
        if mime_type not in ALLOWED_BACKGROUND_MIME_TYPES:
            return Response(
                {"error": "Only JPEG, PNG, and WebP images are allowed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        size = validate_attachment_size(request.data.get("size"))
        asset_key = f"instance-theme/{uuid.uuid4().hex}-{name}"
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": mime_type, "size": size},
            asset=asset_key,
            size=size,
            user=request.user,
            created_by=request.user,
            entity_type=FileAsset.EntityTypeContext.INSTANCE_BACKGROUND,
            entity_identifier="instance-interface-background",
        )

        storage = S3Storage(request=request)
        upload_data = storage.generate_presigned_post(
            object_name=asset_key,
            file_type=mime_type,
            file_size=size,
        )
        return Response(
            {
                "upload_data": upload_data,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, asset_id):
        asset = FileAsset.objects.filter(
            id=asset_id,
            created_by=request.user,
            entity_type=FileAsset.EntityTypeContext.INSTANCE_BACKGROUND,
            is_deleted=False,
        ).first()
        if asset is None:
            return Response(
                {"error": "Background image not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        asset.is_uploaded = True
        asset.save(update_fields=["is_uploaded"])
        return Response({"asset_url": asset.asset_url}, status=status.HTTP_200_OK)


class InstanceThemeApplyEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    @invalidate_cache(path="/api/instances/configurations/", user=False)
    @invalidate_cache(path="/api/instances/", user=False)
    def post(self, request):
        try:
            settings = _validated_theme_settings(request.data)
        except ValueError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        configuration_values = {
            "DEFAULT_INTERFACE_THEME": settings["theme"],
            "DEFAULT_GLASS_ACCENT_COLOR": settings["glass_accent_color"],
            "DEFAULT_GLASS_BACKGROUND": settings["glass_background"],
            "DEFAULT_GLASS_BACKGROUND_URL": settings["glass_background_url"],
            "DEFAULT_GLASS_OVERLAY_OPACITY": str(settings["glass_overlay_opacity"]),
        }
        if settings["glass_workspace_opacity"] is not None:
            configuration_values["DEFAULT_GLASS_WORKSPACE_OPACITY"] = str(settings["glass_workspace_opacity"])
        if settings["glass_task_opacity"] is not None:
            configuration_values["DEFAULT_GLASS_TASK_OPACITY"] = str(settings["glass_task_opacity"])

        with transaction.atomic():
            for key, value in configuration_values.items():
                configuration, _ = InstanceConfiguration.objects.get_or_create(
                    key=key,
                    defaults={
                        "category": "INTERFACE",
                        "is_encrypted": False,
                    },
                )
                configuration.category = "INTERFACE"
                configuration.is_encrypted = False
                configuration.value = value
                configuration.save(update_fields=["category", "is_encrypted", "value", "updated_at"])

            profiles = list(Profile.objects.all().only("id", "theme"))
            for profile in profiles:
                profile_theme = dict(profile.theme or {})
                profile_theme.update(
                    {
                        "theme": settings["theme"],
                        "glassAccentColor": settings["glass_accent_color"],
                        "glassBackground": settings["glass_background"],
                        "glassBackgroundUrl": settings["glass_background_url"],
                        "glassOverlayOpacity": settings["glass_overlay_opacity"],
                    }
                )
                if settings["glass_workspace_opacity"] is not None:
                    profile_theme["glassWorkspaceOpacity"] = settings["glass_workspace_opacity"]
                if settings["glass_task_opacity"] is not None:
                    profile_theme["glassTaskOpacity"] = settings["glass_task_opacity"]
                profile.theme = profile_theme

            if profiles:
                Profile.objects.bulk_update(profiles, ["theme"], batch_size=500)

        return Response({"updated_count": len(profiles)}, status=status.HTTP_200_OK)
