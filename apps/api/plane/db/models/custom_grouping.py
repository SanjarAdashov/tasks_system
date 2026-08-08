# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from .base import BaseModel


class CustomGroupingAccess(models.TextChoices):
    PERSONAL = "PERSONAL", "Personal"
    PROJECT = "PROJECT", "Project"


class CustomGroupingDateBucket(models.TextChoices):
    EXACT = "EXACT", "Exact date"
    DAY = "DAY", "Day"
    WEEK = "WEEK", "Week"
    MONTH = "MONTH", "Month"


class ProjectCustomGrouping(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="custom_groupings",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="custom_groupings",
    )
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_custom_groupings",
    )
    name = models.CharField(max_length=255)
    group_by = models.CharField(max_length=96)
    date_bucket = models.CharField(
        max_length=16,
        choices=CustomGroupingDateBucket.choices,
        null=True,
        blank=True,
    )
    access = models.CharField(
        max_length=16,
        choices=CustomGroupingAccess.choices,
        default=CustomGroupingAccess.PERSONAL,
    )

    class Meta:
        verbose_name = "Project Custom Grouping"
        verbose_name_plural = "Project Custom Groupings"
        db_table = "project_custom_groupings"
        ordering = ("access", "name", "created_at")
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "project",
                "owned_by",
                condition=Q(access=CustomGroupingAccess.PERSONAL, deleted_at__isnull=True),
                name="unique_personal_custom_grouping_name",
            ),
            models.UniqueConstraint(
                Lower("name"),
                "project",
                condition=Q(access=CustomGroupingAccess.PROJECT, deleted_at__isnull=True),
                name="unique_project_custom_grouping_name",
            ),
        ]


class ProjectCustomGroupingPreference(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="custom_grouping_preferences",
    )
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.CASCADE,
        related_name="custom_grouping_preferences",
    )
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="custom_grouping_preferences",
    )
    active_grouping = models.ForeignKey(
        ProjectCustomGrouping,
        on_delete=models.SET_NULL,
        related_name="active_preferences",
        null=True,
        blank=True,
    )
    collapsed_groups = models.JSONField(default=dict)

    class Meta:
        verbose_name = "Project Custom Grouping Preference"
        verbose_name_plural = "Project Custom Grouping Preferences"
        db_table = "project_custom_grouping_preferences"
        constraints = [
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=Q(deleted_at__isnull=True),
                name="unique_project_custom_grouping_preference",
            )
        ]
