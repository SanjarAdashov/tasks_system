# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from plane.app.permissions import ProjectAdminPermission, ProjectLitePermission
from plane.app.serializers import ProjectAttachmentSettingsSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectAttachmentSettings


class ProjectAttachmentSettingsEndpoint(BaseAPIView):
    def get_permissions(self):
        permission_classes = (
            [ProjectLitePermission] if self.request.method in SAFE_METHODS else [ProjectAdminPermission]
        )
        return [permission() for permission in permission_classes]

    def get_project(self, slug, project_id):
        return get_object_or_404(
            Project,
            id=project_id,
            workspace__slug=slug,
        )

    def get_settings(self, project):
        settings, _ = ProjectAttachmentSettings.objects.get_or_create(project=project)
        return settings

    def get(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        serializer = ProjectAttachmentSettingsSerializer(self.get_settings(project))
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        serializer = ProjectAttachmentSettingsSerializer(
            self.get_settings(project),
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)
