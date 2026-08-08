# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Count, Exists, OuterRef, Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import Project, ProjectMember, ProjectUserGroup, User, Workspace
from plane.app.serializers import ProjectUserGroupSerializer, UserLiteSerializer
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.api.serializers import InstanceUserSerializer
from plane.license.models import Instance, InstanceAdmin
from plane.license.services import (
    CreationQuotaError,
    UserAccessError,
    block_user,
    creation_quota_snapshot,
    update_project_limit,
    update_workspace_limit,
    unblock_user,
)
from .base import BaseAPIView


def instance_user_queryset():
    instance = Instance.objects.first()
    admin_membership = InstanceAdmin.objects.filter(
        instance=instance,
        user_id=OuterRef("pk"),
    )
    return (
        User.objects.filter(is_bot=False)
        .select_related("blocked_by")
        .annotate(is_instance_admin=Exists(admin_membership))
    )


def error_response(exc):
    return Response(
        {
            "error": {
                "code": exc.code,
                "message": exc.message,
            }
        },
        status=exc.status_code,
    )


class InstanceUserEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        users = instance_user_queryset()
        stats = users.aggregate(
            total_users=Count("id"),
            active_users=Count("id", filter=Q(is_active=True, blocked_at__isnull=True)),
            blocked_users=Count("id", filter=Q(blocked_at__isnull=False)),
        )

        search = request.query_params.get("search", "").strip()
        if search:
            users = users.filter(
                Q(email__icontains=search)
                | Q(display_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
            )

        return self.paginate(
            request=request,
            queryset=users,
            on_results=lambda results: InstanceUserSerializer(results, many=True).data,
            extra_stats=stats,
            max_per_page=100,
            default_per_page=50,
        )


class InstanceUserBlockEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request, user_id):
        try:
            block_user(
                user_id=user_id,
                actor=request.user,
                reason=request.data.get("reason"),
            )
        except UserAccessError as exc:
            return error_response(exc)

        user = instance_user_queryset().get(pk=user_id)
        return Response(
            InstanceUserSerializer(user).data,
            status=status.HTTP_200_OK,
        )


class InstanceUserUnblockEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request, user_id):
        try:
            unblock_user(
                user_id=user_id,
                actor=request.user,
                reason=request.data.get("reason", ""),
            )
        except UserAccessError as exc:
            return error_response(exc)

        user = instance_user_queryset().get(pk=user_id)
        return Response(
            InstanceUserSerializer(user).data,
            status=status.HTTP_200_OK,
        )


class InstanceUserCreationQuotaEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def _user(self, user_id):
        return User.objects.get(pk=user_id, is_bot=False)

    def get(self, request, user_id):
        try:
            user = self._user(user_id)
        except User.DoesNotExist:
            return Response({"error": "User does not exist"}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            creation_quota_snapshot(user, include_inactive_memberships=True),
            status=status.HTTP_200_OK,
        )

    def patch(self, request, user_id):
        try:
            user = self._user(user_id)
            if "workspace_limit" in request.data:
                update_workspace_limit(user=user, limit=request.data.get("workspace_limit"))

            project_quota = request.data.get("project_quota")
            if project_quota is not None:
                if (
                    not isinstance(project_quota, dict)
                    or "workspace_id" not in project_quota
                    or "limit" not in project_quota
                ):
                    raise CreationQuotaError(
                        "invalid_quota_payload",
                        "project_quota requires workspace_id and limit.",
                        400,
                    )
                workspace = Workspace.objects.get(pk=project_quota["workspace_id"])
                update_project_limit(user=user, workspace=workspace, limit=project_quota.get("limit"))
        except User.DoesNotExist:
            return Response({"error": "User does not exist"}, status=status.HTTP_404_NOT_FOUND)
        except Workspace.DoesNotExist:
            return Response({"error": "Workspace does not exist"}, status=status.HTTP_404_NOT_FOUND)
        except CreationQuotaError as exc:
            return Response({"error": {"code": exc.code, "message": exc.message}}, status=exc.status_code)

        return Response(
            creation_quota_snapshot(user, include_inactive_memberships=True),
            status=status.HTTP_200_OK,
        )


class InstanceProjectUserGroupContextEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        workspaces = [
            {
                "id": str(workspace.id),
                "name": workspace.name,
                "slug": workspace.slug,
                "projects": [
                    {"id": str(project.id), "name": project.name, "identifier": project.identifier}
                    for project in Project.objects.filter(workspace=workspace).order_by("name")
                ],
            }
            for workspace in Workspace.objects.order_by("name")
        ]
        project_id = request.query_params.get("project_id")
        if not project_id:
            return Response({"workspaces": workspaces, "groups": [], "eligible_members": []})
        try:
            project = Project.objects.get(pk=project_id)
        except (Project.DoesNotExist, ValueError):
            return Response({"error": "Project does not exist"}, status=status.HTTP_404_NOT_FOUND)
        groups = ProjectUserGroup.objects.filter(project=project).prefetch_related("memberships__member")
        if request.query_params.get("include_archived") == "true":
            groups = ProjectUserGroup.all_objects.filter(
                project=project,
                deleted_at__isnull=True,
            ).prefetch_related("memberships__member")
        else:
            groups = groups.filter(archived_at__isnull=True)
        member_ids = ProjectMember.objects.filter(
            project=project,
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).values_list("member_id", flat=True)
        return Response(
            {
                "workspaces": workspaces,
                "groups": ProjectUserGroupSerializer(groups, many=True, context={"project": project}).data,
                "eligible_members": UserLiteSerializer(User.objects.filter(id__in=member_ids), many=True).data,
            }
        )
