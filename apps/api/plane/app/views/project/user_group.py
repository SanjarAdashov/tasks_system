# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from plane.app.serializers import ProjectUserGroupSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import (
    Project,
    ProjectMember,
    ProjectStateTransitionRule,
    ProjectUserGroup,
    ProjectUserGroupMember,
)
from plane.license.models import InstanceAdmin


class ProjectUserGroupAdminPermission(BasePermission):
    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        if InstanceAdmin.objects.filter(user=request.user).exists():
            return True
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            project_id=view.project_id,
            member=request.user,
            role=20,
            is_active=True,
        ).exists()


def _condition_tree_references_group(node, group_id):
    if not isinstance(node, dict):
        return False
    if node.get("kind") == "condition":
        field = node.get("field", "")
        return (field.endswith(".group") or ".group_" in field) and str(node.get("value")) == str(group_id)
    return any(_condition_tree_references_group(child, group_id) for child in node.get("children") or [])


def group_is_referenced(group):
    for rule in ProjectStateTransitionRule.all_objects.filter(
        project=group.project,
        deleted_at__isnull=True,
    ):
        if any(
            _condition_tree_references_group(tree, group.id)
            for tree in (rule.allow_conditions, rule.deny_conditions, rule.validation_conditions)
        ):
            return True
    return False


class ProjectUserGroupViewSet(BaseViewSet):
    serializer_class = ProjectUserGroupSerializer
    model = ProjectUserGroup
    permission_classes = [ProjectUserGroupAdminPermission]

    def get_project(self):
        return get_object_or_404(
            Project,
            id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )

    def get_queryset(self):
        queryset = ProjectUserGroup.objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).prefetch_related("memberships__member")
        if self.request.query_params.get("include_archived") != "true":
            queryset = queryset.filter(archived_at__isnull=True)
        return queryset.order_by("name")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = self.get_project()
        return context

    def create(self, request, slug, project_id):
        project = self.get_project()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save(project=project, workspace=project.workspace)
        except IntegrityError:
            return Response(
                {"name": "An active group with this name already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, slug, project_id, pk):
        group = self.get_object()
        serializer = self.get_serializer(group, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
        except IntegrityError:
            return Response(
                {"name": "An active group with this name already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def destroy(self, request, slug, project_id, pk):
        group = self.get_object()
        if request.query_params.get("permanent") == "true":
            if group_is_referenced(group):
                return Response(
                    {"error": {"code": "group_in_use", "message": "This group is used by a status transition rule."}},
                    status=status.HTTP_409_CONFLICT,
                )
            group.delete(soft=False)
        else:
            group.archived_at = timezone.now()
            group.save(update_fields=["archived_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def restore(self, request, slug, project_id, pk):
        group = get_object_or_404(
            ProjectUserGroup.all_objects,
            pk=pk,
            project_id=project_id,
            workspace__slug=slug,
            deleted_at__isnull=True,
        )
        group.archived_at = None
        try:
            group.save(update_fields=["archived_at", "updated_at"])
        except IntegrityError:
            return Response(
                {"name": "An active group with this name already exists."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(self.get_serializer(group).data, status=status.HTTP_200_OK)

    def update_members(self, request, slug, project_id, pk):
        group = self.get_object()
        add_ids = list(dict.fromkeys(request.data.get("add_member_ids") or []))
        remove_ids = list(dict.fromkeys(request.data.get("remove_member_ids") or []))
        eligible = set(
            str(member_id)
            for member_id in ProjectMember.objects.filter(
                project=group.project,
                member_id__in=add_ids,
                is_active=True,
                member__is_active=True,
                member__blocked_at__isnull=True,
            ).values_list("member_id", flat=True)
        )
        if eligible != {str(member_id) for member_id in add_ids}:
            return Response(
                {"add_member_ids": "All added users must be active project members."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            for member_id in add_ids:
                membership = ProjectUserGroupMember.all_objects.filter(group=group, member_id=member_id).first()
                if membership:
                    membership.deleted_at = None
                    membership.save(update_fields=["deleted_at", "updated_at"])
                else:
                    ProjectUserGroupMember.objects.create(
                        workspace=group.workspace,
                        project=group.project,
                        group=group,
                        member_id=member_id,
                    )
            ProjectUserGroupMember.objects.filter(group=group, member_id__in=remove_ids).delete()
        group = self.get_queryset().get(pk=group.pk)
        return Response(self.get_serializer(group).data, status=status.HTTP_200_OK)
