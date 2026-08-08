# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import IntegrityError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from plane.app.serializers import (
    ProjectCustomGroupingPreferenceSerializer,
    ProjectCustomGroupingSerializer,
)
from plane.app.serializers.custom_grouping import is_custom_grouping_field_available
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    CustomGroupingAccess,
    Project,
    ProjectCustomGrouping,
    ProjectCustomGroupingPreference,
    ProjectMember,
)
from plane.license.models import InstanceAdmin


def is_instance_admin(user):
    return InstanceAdmin.objects.filter(user=user).exists()


def is_project_admin(user, project_id, slug):
    return is_instance_admin(user) or ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        role=20,
        is_active=True,
    ).exists()


class ProjectCustomGroupingPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        if is_instance_admin(request.user):
            return True
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            project_id=view.project_id,
            member=request.user,
            is_active=True,
        ).exists()


class ProjectCustomGroupingViewSet(BaseViewSet):
    serializer_class = ProjectCustomGroupingSerializer
    model = ProjectCustomGrouping
    permission_classes = [ProjectCustomGroupingPermission]

    def get_project(self):
        return get_object_or_404(
            Project,
            id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )

    def get_queryset(self):
        return ProjectCustomGrouping.objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).filter(Q(access=CustomGroupingAccess.PROJECT) | Q(owned_by=self.request.user))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = self.get_project()
        return context

    def list(self, request, slug, project_id):
        project = self.get_project()
        queryset = self.get_queryset().select_related("owned_by")
        stale_ids = [
            grouping.id
            for grouping in queryset
            if not is_custom_grouping_field_available(project, grouping.group_by)
        ]
        if stale_ids:
            ProjectCustomGrouping.objects.filter(id__in=stale_ids).delete()
            queryset = self.get_queryset().select_related("owned_by")
        return Response(self.get_serializer(queryset, many=True).data)

    def create(self, request, slug, project_id):
        project = self.get_project()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if (
            serializer.validated_data.get("access") == CustomGroupingAccess.PROJECT
            and not is_project_admin(request.user, project_id, slug)
        ):
            return Response(
                {"access": "Only a project administrator can create a shared configuration."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            serializer.save(
                project=project,
                workspace=project.workspace,
                owned_by=request.user,
            )
        except IntegrityError:
            return Response({"name": "A configuration with this name already exists."}, status=status.HTTP_409_CONFLICT)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, slug, project_id, pk):
        grouping = self.get_object()
        if grouping.access == CustomGroupingAccess.PROJECT:
            allowed = is_project_admin(request.user, project_id, slug)
        else:
            allowed = grouping.owned_by_id == request.user.id
        if not allowed:
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(grouping, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if (
            serializer.validated_data.get("access") == CustomGroupingAccess.PROJECT
            and not is_project_admin(request.user, project_id, slug)
        ):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            serializer.save()
        except IntegrityError:
            return Response({"name": "A configuration with this name already exists."}, status=status.HTTP_409_CONFLICT)
        return Response(serializer.data)

    def destroy(self, request, slug, project_id, pk):
        grouping = self.get_object()
        if grouping.access == CustomGroupingAccess.PROJECT:
            allowed = is_project_admin(request.user, project_id, slug)
        else:
            allowed = grouping.owned_by_id == request.user.id
        if not allowed:
            return Response(status=status.HTTP_403_FORBIDDEN)
        grouping.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectCustomGroupingPreferenceEndpoint(BaseAPIView):
    permission_classes = [ProjectCustomGroupingPermission]

    def get_project(self, slug, project_id):
        return get_object_or_404(Project, id=project_id, workspace__slug=slug)

    def get_preference(self, project, user):
        preference, _ = ProjectCustomGroupingPreference.objects.get_or_create(
            project=project,
            member=user,
            defaults={"workspace": project.workspace},
        )
        return preference

    def get(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        preference = self.get_preference(project, request.user)
        return Response(
            ProjectCustomGroupingPreferenceSerializer(
                preference,
                context={"project": project, "request": request},
            ).data
        )

    def patch(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        preference = self.get_preference(project, request.user)
        serializer = ProjectCustomGroupingPreferenceSerializer(
            preference,
            data=request.data,
            partial=True,
            context={"project": project, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
