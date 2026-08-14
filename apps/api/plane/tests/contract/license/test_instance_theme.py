# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import FileAsset, Profile, User
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration


def create_user(label):
    unique = uuid.uuid4().hex[:8]
    return User.objects.create(
        email=f"{label}-{unique}@plane.so",
        username=f"{label}-{unique}",
        first_name=label.title(),
    )


def create_instance(admin):
    instance = Instance.objects.create(
        instance_name="Theme Test",
        instance_id=uuid.uuid4().hex,
        current_version="1.4.0",
        last_checked_at=timezone.now(),
    )
    InstanceAdmin.objects.create(instance=instance, user=admin)
    return instance


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceInterfaceTheme:
    def test_instance_admin_can_apply_theme_to_every_profile(self):
        admin = create_user("admin")
        member = create_user("member")
        create_instance(admin)
        Profile.objects.create(
            user=admin,
            theme={"theme": "dark", "glassTaskOpacity": 72},
        )
        Profile.objects.create(user=member, theme={"theme": "light"})

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(
            "/api/instances/interface-theme/apply/",
            {
                "theme": "gts-glass-dark",
                "glass_accent_color": "#4F8CFF",
                "glass_background": "gts-tasks",
                "glass_background_url": "",
                "glass_overlay_opacity": 48,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"updated_count": 2}

        admin_profile = Profile.objects.get(user=admin)
        member_profile = Profile.objects.get(user=member)
        for profile in (admin_profile, member_profile):
            assert profile.theme["theme"] == "gts-glass-dark"
            assert profile.theme["glassAccentColor"] == "#4F8CFF"
            assert profile.theme["glassBackground"] == "gts-tasks"
            assert profile.theme["glassBackgroundUrl"] == ""
            assert profile.theme["glassOverlayOpacity"] == 48
        assert admin_profile.theme["glassTaskOpacity"] == 72

        assert InstanceConfiguration.objects.get(key="DEFAULT_INTERFACE_THEME").value == "gts-glass-dark"
        assert InstanceConfiguration.objects.get(key="DEFAULT_GLASS_ACCENT_COLOR").value == "#4F8CFF"
        assert InstanceConfiguration.objects.get(key="DEFAULT_GLASS_BACKGROUND").value == "gts-tasks"
        assert InstanceConfiguration.objects.get(key="DEFAULT_GLASS_OVERLAY_OPACITY").value == "48"

    def test_non_instance_admin_cannot_apply_theme(self):
        admin = create_user("admin")
        member = create_user("member")
        create_instance(admin)
        Profile.objects.create(user=member)

        client = APIClient()
        client.force_authenticate(user=member)
        response = client.post(
            "/api/instances/interface-theme/apply/",
            {
                "theme": "dark",
                "glass_accent_color": "#19A7F6",
                "glass_background": "none",
                "glass_background_url": "",
                "glass_overlay_opacity": 46,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Profile.objects.get(user=member).theme == {}

    def test_custom_background_must_reference_uploaded_instance_asset(self):
        admin = create_user("admin")
        create_instance(admin)
        Profile.objects.create(user=admin)

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(
            "/api/instances/interface-theme/apply/",
            {
                "theme": "gts-glass-dark",
                "glass_accent_color": "#19A7F6",
                "glass_background": "custom",
                "glass_background_url": "/api/assets/v2/static/00000000-0000-0000-0000-000000000000/",
                "glass_overlay_opacity": 46,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "unavailable" in response.data["error"].lower()

    def test_background_upload_rejects_non_image_files(self):
        admin = create_user("admin")
        create_instance(admin)

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(
            "/api/instances/interface-theme/background/",
            {
                "name": "notes.pdf",
                "type": "application/pdf",
                "size": 128,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "jpeg" in response.data["error"].lower()

    def test_instance_background_upload_is_separate_from_user_cover(self, mocker):
        admin = create_user("admin")
        create_instance(admin)
        mocker.patch(
            "plane.license.api.views.theme.S3Storage.generate_presigned_post",
            return_value={"url": "http://storage.test/upload", "fields": {}},
        )

        client = APIClient()
        client.force_authenticate(user=admin)
        create_response = client.post(
            "/api/instances/interface-theme/background/",
            {
                "name": "wallpaper.webp",
                "type": "image/webp",
                "size": 256,
            },
            format="json",
        )

        assert create_response.status_code == status.HTTP_200_OK
        asset = FileAsset.objects.get(id=create_response.data["asset_id"])
        assert asset.entity_type == FileAsset.EntityTypeContext.INSTANCE_BACKGROUND
        assert asset.user_id == admin.id
        assert admin.cover_image_asset_id is None

        complete_response = client.patch(
            f"/api/instances/interface-theme/background/{asset.id}/",
            {},
            format="json",
        )
        assert complete_response.status_code == status.HTTP_200_OK
        asset.refresh_from_db()
        assert asset.is_uploaded is True
        assert complete_response.data["asset_url"] == asset.asset_url
