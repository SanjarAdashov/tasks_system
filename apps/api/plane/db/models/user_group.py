# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from .base import BaseModel


class ProjectUserGroup(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="project_user_groups",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="user_groups",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Project User Group"
        verbose_name_plural = "Project User Groups"
        db_table = "project_user_groups"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "project",
                condition=Q(archived_at__isnull=True, deleted_at__isnull=True),
                name="unique_active_project_user_group_name",
            )
        ]


class ProjectUserGroupMember(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="project_user_group_memberships",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="user_group_memberships",
    )
    group = models.ForeignKey(
        ProjectUserGroup,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_user_group_memberships",
    )

    class Meta:
        verbose_name = "Project User Group Member"
        verbose_name_plural = "Project User Group Members"
        db_table = "project_user_group_members"
        constraints = [
            models.UniqueConstraint(
                fields=["group", "member"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_project_user_group_member",
            )
        ]
