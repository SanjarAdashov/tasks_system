# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Count, Exists, OuterRef, Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import User
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.api.serializers import InstanceUserSerializer
from plane.license.models import Instance, InstanceAdmin
from plane.license.services import (
    UserAccessError,
    block_user,
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
