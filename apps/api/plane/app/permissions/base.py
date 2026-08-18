# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import WorkspaceMember, ProjectMember
from functools import wraps
from rest_framework.response import Response
from rest_framework import status

from enum import Enum


class ROLE(Enum):
    ADMIN = 20
    MEMBER = 15
    GUEST = 5


def allow_permission(allowed_roles, level="PROJECT", creator=False, model=None):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # Instance administrators have system-wide authority, including
            # restricted tasks, without requiring a project membership row.
            from plane.utils.issue_access import is_instance_admin

            if is_instance_admin(request.user):
                return view_func(instance, request, *args, **kwargs)

            # Every nested issue route must resolve the parent through the
            # access-aware Issue manager before touching comments, assets,
            # relations, reactions, or other child records. Return 404 so a
            # caller cannot use the endpoint as an existence oracle.
            issue_id = kwargs.get("issue_id") or (
                kwargs.get("pk") if model is not None and model.__name__ == "Issue" else None
            )
            if issue_id:
                from plane.db.models import Issue

                if not Issue.objects.filter(
                    id=issue_id,
                    project_id=kwargs.get("project_id"),
                    workspace__slug=kwargs.get("slug"),
                ).exists():
                    return Response(
                        {"error": "The required object does not exist."},
                        status=status.HTTP_404_NOT_FOUND,
                    )

            # Check for creator if required
            if creator and model:
                # check if the user is part of the workspace or not
                if not WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    is_active=True,
                ).exists():
                    return Response(
                        {"error": "You don't have the required permissions."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                obj = model.objects.filter(id=kwargs["pk"], created_by=request.user).exists()
                if obj:
                    return view_func(instance, request, *args, **kwargs)

            # Convert allowed_roles to their values if they are enum members
            allowed_role_values = [role.value if isinstance(role, ROLE) else role for role in allowed_roles]

            # Check role permissions
            if level == "WORKSPACE":
                if WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists():
                    return view_func(instance, request, *args, **kwargs)
            else:
                is_user_has_allowed_role = ProjectMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    project_id=kwargs["project_id"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists()

                # Return if the user has the allowed role else if they are workspace admin and part of the project regardless of the role # noqa: E501
                if is_user_has_allowed_role:
                    return view_func(instance, request, *args, **kwargs)
                elif WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    role=ROLE.ADMIN.value,
                    is_active=True,
                ).exists():
                    return view_func(instance, request, *args, **kwargs)

            # Return permission denied if no conditions are met
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return _wrapped_view

    return decorator
