# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.db.models import Q

from .base import BaseModel


class ProjectCreationQuota(BaseModel):
    """Per-user project creation allowance within one workspace.

    A null limit is unlimited. Missing rows and zero both deny project creation
    for regular users; instance administrators are handled as an unlimited
    override by the quota service.
    """

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="project_creation_quotas",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_creation_quotas",
    )
    limit = models.PositiveIntegerField(null=True, blank=True, default=0)

    class Meta:
        verbose_name = "Project Creation Quota"
        verbose_name_plural = "Project Creation Quotas"
        db_table = "project_creation_quotas"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_project_creation_quota",
            )
        ]
