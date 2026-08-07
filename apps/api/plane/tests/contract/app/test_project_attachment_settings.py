# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from plane.db.models import (
    FileAsset,
    Issue,
    Project,
    ProjectAttachmentSettings,
    ProjectMember,
    User,
    WorkspaceMember,
)
from plane.utils.attachments import (
    get_attachment_disposition,
    validate_project_attachment_size,
)


MEBIBYTE = 1024 * 1024


def _settings_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/attachment-settings/"


def _attachment_url(workspace, project, issue, attachment=None):
    url = f"/api/assets/v2/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/attachments/"
    return f"{url}{attachment.id}/" if attachment else url


def _create_project_member(workspace, project, username):
    user = User.objects.create_user(
        email=f"{username}@plane.so",
        username=username,
        password="test-password",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=15,
        is_active=True,
    )
    return user


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Attachment settings",
        identifier="FILES",
        workspace=workspace,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectAttachmentSettings:
    def test_defaults_are_created_and_project_admin_can_update(self, session_client, workspace, project):
        response = session_client.get(_settings_url(workspace, project))

        assert response.status_code == status.HTTP_200_OK
        assert response.data["image_max_size"] == 20 * MEBIBYTE
        assert response.data["video_max_size"] == 500 * MEBIBYTE
        assert response.data["other_max_size"] == 25 * MEBIBYTE

        response = session_client.patch(
            _settings_url(workspace, project),
            {
                "image_max_size": 0,
                "video_max_size": None,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["image_max_size"] == 0
        assert response.data["video_max_size"] is None

    def test_project_member_can_read_but_cannot_update(self, workspace, project):
        member = User.objects.create_user(
            email="attachment-member@plane.so",
            username="attachment-member",
            password="test-password",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace,
            project=project,
            member=member,
            role=15,
            is_active=True,
        )
        client = APIClient()
        client.force_authenticate(user=member)

        assert client.get(_settings_url(workspace, project)).status_code == status.HTTP_200_OK
        response = client.patch(
            _settings_url(workspace, project),
            {"image_max_size": 1},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_category_limits_support_disabled_unlimited_and_maximum(self, project):
        settings = ProjectAttachmentSettings.objects.create(
            project=project,
            image_max_size=0,
            video_max_size=None,
            pdf_max_size=10,
        )

        with pytest.raises(ValidationError):
            validate_project_attachment_size(
                project=project,
                mime_type="image/png",
                filename="image.png",
                size=1,
            )

        assert (
            validate_project_attachment_size(
                project=project,
                mime_type="video/mp4",
                filename="video.mp4",
                size=10 * MEBIBYTE,
            )
            == 10 * MEBIBYTE
        )

        with pytest.raises(ValidationError):
            validate_project_attachment_size(
                project=project,
                mime_type="application/pdf",
                filename="document.pdf",
                size=11,
            )

        settings.pdf_max_size = 11
        settings.save(update_fields=["pdf_max_size"])
        assert (
            validate_project_attachment_size(
                project=project,
                mime_type="application/pdf",
                filename="document.pdf",
                size=11,
            )
            == 11
        )

    def test_inline_disposition_is_limited_to_safe_preview_types(self):
        assert get_attachment_disposition("image/png", "inline") == "inline"
        assert get_attachment_disposition("video/mp4", "inline") == "inline"
        assert get_attachment_disposition("audio/mpeg", "inline") == "inline"
        assert get_attachment_disposition("application/pdf", "inline") == "inline"
        assert get_attachment_disposition("image/svg+xml", "inline") == "attachment"
        assert get_attachment_disposition("text/html", "inline") == "attachment"
        assert get_attachment_disposition("image/png", None) == "attachment"

    def test_v2_attachment_upload_enforces_project_limit(self, session_client, workspace, project):
        issue = Issue.objects.create(
            workspace=workspace,
            project=project,
            name="Attachment limit",
        )
        ProjectAttachmentSettings.objects.create(project=project, image_max_size=5)

        response = session_client.post(
            _attachment_url(workspace, project, issue),
            {
                "name": "too-large.png",
                "type": "image/png",
                "size": 6,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not FileAsset.objects.filter(issue=issue).exists()

    @patch("plane.app.views.issue.attachment.issue_activity.delay")
    def test_delete_requires_uploader_issue_creator_or_project_admin(
        self,
        mock_activity,
        workspace,
        project,
        create_user,
    ):
        uploader = _create_project_member(workspace, project, "attachment-uploader")
        ordinary_member = _create_project_member(workspace, project, "attachment-ordinary")
        issue = Issue.objects.create(
            workspace=workspace,
            project=project,
            name="Attachment delete",
            created_by=create_user,
        )
        attachment = FileAsset(
            workspace=workspace,
            project=project,
            issue=issue,
            created_by=uploader,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            attributes={"name": "file.txt", "type": "text/plain", "size": 1},
            asset="test/file.txt",
            size=1,
            is_uploaded=True,
        )
        attachment.save(disable_auto_set_user=True)
        ordinary_client = APIClient()
        ordinary_client.force_authenticate(user=ordinary_member)

        response = ordinary_client.delete(_attachment_url(workspace, project, issue, attachment))
        assert response.status_code == status.HTTP_403_FORBIDDEN

        uploader_client = APIClient()
        uploader_client.force_authenticate(user=uploader)
        response = uploader_client.delete(_attachment_url(workspace, project, issue, attachment))

        assert response.status_code == status.HTTP_204_NO_CONTENT, response.data
        attachment.refresh_from_db()
        assert attachment.is_deleted is True
        mock_activity.assert_called_once()
