# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from dataclasses import dataclass

from django.db import transaction

from plane.db.models import (
    Project,
    ProjectCreationQuota,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import InstanceAdmin


@dataclass
class CreationQuotaError(Exception):
    code: str
    message: str
    status_code: int = 403

    def __str__(self):
        return self.message


def is_instance_admin(user):
    return bool(user and InstanceAdmin.objects.filter(user=user).exists())


def _ensure_active_user(user):
    if not user.is_active or user.blocked_at is not None:
        raise CreationQuotaError(
            code="user_creation_blocked",
            message="This account cannot create workspaces or projects.",
        )


def _quota_values(limit, used, *, unlimited_override=False):
    unlimited = unlimited_override or limit is None
    return {
        "limit": None if unlimited else limit,
        "used": used,
        "remaining": None if unlimited else max(limit - used, 0),
        "is_unlimited": unlimited,
        "can_create": unlimited or used < limit,
    }


def workspace_quota_snapshot(user):
    unlimited = is_instance_admin(user)
    used = Workspace.objects.filter(owner=user).count()
    return _quota_values(user.workspace_creation_limit, used, unlimited_override=unlimited)


def project_quota_snapshot(user, workspace):
    unlimited = is_instance_admin(user)
    limit = ProjectCreationQuota.objects.filter(user=user, workspace=workspace).values_list("limit", flat=True).first()
    if limit is None and not ProjectCreationQuota.objects.filter(user=user, workspace=workspace).exists():
        limit = 0
    used = Project.objects.filter(workspace=workspace, created_by=user).count()
    data = _quota_values(limit, used, unlimited_override=unlimited)
    data.update(
        {
            "workspace_id": str(workspace.id),
            "workspace_name": workspace.name,
            "workspace_slug": workspace.slug,
            "membership_active": WorkspaceMember.objects.filter(
                workspace=workspace,
                member=user,
                is_active=True,
            ).exists(),
        }
    )
    return data


def creation_quota_snapshot(user, *, include_inactive_memberships=False):
    memberships = WorkspaceMember.objects.filter(member=user)
    if not include_inactive_memberships:
        memberships = memberships.filter(is_active=True)
    workspace_ids = set(memberships.values_list("workspace_id", flat=True))
    workspace_ids.update(ProjectCreationQuota.objects.filter(user=user).values_list("workspace_id", flat=True))
    workspaces = Workspace.objects.filter(id__in=workspace_ids).order_by("name")
    return {
        "user_id": str(user.id),
        "is_instance_admin": is_instance_admin(user),
        "workspace": workspace_quota_snapshot(user),
        "projects": [project_quota_snapshot(user, workspace) for workspace in workspaces],
    }


def assert_can_create_workspace(user):
    """Lock the creator row and enforce the global workspace quota.

    Callers must invoke this inside the same transaction that creates the
    workspace. The user-row lock serializes concurrent create requests.
    """

    locked_user = User.objects.select_for_update().get(pk=user.pk)
    _ensure_active_user(locked_user)
    snapshot = workspace_quota_snapshot(locked_user)
    if not snapshot["can_create"]:
        raise CreationQuotaError(
            code="workspace_quota_exceeded",
            message="Your workspace creation quota has been reached.",
        )
    return snapshot


def assert_can_create_project(user, workspace):
    """Lock the creator row and enforce active membership plus project quota."""

    locked_user = User.objects.select_for_update().get(pk=user.pk)
    _ensure_active_user(locked_user)
    if not WorkspaceMember.objects.filter(
        workspace=workspace,
        member=locked_user,
        is_active=True,
    ).exists():
        raise CreationQuotaError(
            code="workspace_membership_required",
            message="An active workspace membership is required to create a project.",
        )
    snapshot = project_quota_snapshot(locked_user, workspace)
    if not snapshot["can_create"]:
        raise CreationQuotaError(
            code="project_quota_exceeded",
            message="Your project creation quota for this workspace has been reached.",
        )
    return snapshot


def update_workspace_limit(*, user, limit):
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 0):
        raise CreationQuotaError("invalid_quota", "Quota must be zero, a positive integer, or null.", 400)
    user.workspace_creation_limit = limit
    user.save(update_fields=["workspace_creation_limit", "updated_at"])


@transaction.atomic
def update_project_limit(*, user, workspace, limit):
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 0):
        raise CreationQuotaError("invalid_quota", "Quota must be zero, a positive integer, or null.", 400)
    if not WorkspaceMember.objects.filter(workspace=workspace, member=user).exists():
        raise CreationQuotaError("workspace_membership_required", "The user is not a workspace member.", 400)
    quota = (
        ProjectCreationQuota.objects.select_for_update()
        .filter(
            workspace=workspace,
            user=user,
        )
        .first()
    )
    if quota is None:
        quota = (
            ProjectCreationQuota.all_objects.select_for_update()
            .filter(
                workspace=workspace,
                user=user,
            )
            .first()
        )
    if quota is None:
        ProjectCreationQuota.objects.create(workspace=workspace, user=user, limit=limit)
        return
    quota.deleted_at = None
    quota.limit = limit
    quota.save(update_fields=["limit", "deleted_at", "updated_at"])
