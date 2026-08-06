# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from plane.app.permissions import ProjectAdminPermission, ProjectLitePermission
from plane.app.serializers import (
    ProjectWorkItemFieldConfigurationSerializer,
    ProjectWorkItemPropertySerializer,
)
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    Project,
    ProjectWorkItemFieldConfiguration,
    ProjectWorkItemProperty,
)


class ProjectWorkItemFieldPermissionMixin:
    def get_permissions(self):
        permission_classes = (
            [ProjectLitePermission] if self.request.method in SAFE_METHODS else [ProjectAdminPermission]
        )
        return [permission() for permission in permission_classes]


class ProjectWorkItemFieldConfigurationEndpoint(
    ProjectWorkItemFieldPermissionMixin,
    BaseAPIView,
):
    def get_project(self, slug, project_id):
        return get_object_or_404(
            Project,
            id=project_id,
            workspace__slug=slug,
        )

    def get_configuration(self, project):
        configuration, _ = ProjectWorkItemFieldConfiguration.objects.get_or_create(
            project=project,
        )
        return configuration

    def get(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        configuration = self.get_configuration(project)
        serializer = ProjectWorkItemFieldConfigurationSerializer(configuration)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        configuration = self.get_configuration(project)
        serializer = ProjectWorkItemFieldConfigurationSerializer(
            configuration,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProjectWorkItemPropertyViewSet(
    ProjectWorkItemFieldPermissionMixin,
    BaseViewSet,
):
    serializer_class = ProjectWorkItemPropertySerializer
    model = ProjectWorkItemProperty

    def get_project(self):
        return get_object_or_404(
            Project,
            id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )

    def get_queryset(self):
        queryset = (
            ProjectWorkItemProperty.objects.filter(
                project_id=self.kwargs.get("project_id"),
                workspace__slug=self.kwargs.get("slug"),
            )
            .prefetch_related("options")
            .order_by("sort_order", "created_at")
        )
        if self.request.query_params.get("include_archived") != "true":
            queryset = queryset.filter(archived_at__isnull=True)
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = self.get_project()
        return context

    def create(self, request, slug, project_id):
        project = self.get_project()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(project=project)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, slug, project_id, pk):
        property_instance = self.get_object()
        property_instance.archived_at = timezone.now()
        property_instance.save(update_fields=["archived_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
