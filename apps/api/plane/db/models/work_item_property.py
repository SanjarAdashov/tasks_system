# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models
from django.db.models import Q

from .project import ProjectBaseModel


BUILT_IN_WORK_ITEM_FIELD_KEYS = (
    "project",
    "title",
    "description",
    "state",
    "priority",
    "assignees",
    "labels",
    "start_date",
    "target_date",
    "cycle",
    "module",
    "estimate",
    "parent",
)

LOCKED_VISIBLE_WORK_ITEM_FIELD_KEYS = (
    "project",
    "title",
    "description",
    "state",
    "priority",
    "assignees",
    "labels",
)
LOCKED_REQUIRED_WORK_ITEM_FIELD_KEYS = ("project", "title")
HIDEABLE_WORK_ITEM_FIELD_KEYS = (
    "start_date",
    "target_date",
    "cycle",
    "module",
    "estimate",
    "parent",
)


def get_default_work_item_field_configuration():
    return {
        field_key: {
            "visible": True,
            "required": field_key in LOCKED_REQUIRED_WORK_ITEM_FIELD_KEYS,
        }
        for field_key in BUILT_IN_WORK_ITEM_FIELD_KEYS
    }


class WorkItemPropertyType(models.TextChoices):
    SHORT_TEXT = "SHORT_TEXT", "Short text"
    LONG_TEXT = "LONG_TEXT", "Long text"
    NUMBER = "NUMBER", "Number"
    DATE = "DATE", "Date"
    CHECKBOX = "CHECKBOX", "Checkbox"
    SINGLE_SELECT = "SINGLE_SELECT", "Single select"
    MULTI_SELECT = "MULTI_SELECT", "Multi select"


class WorkItemSelectSource(models.TextChoices):
    MANUAL = "MANUAL", "Manual list"
    MEMBERS = "MEMBERS", "Project members"


class ProjectWorkItemFieldConfiguration(ProjectBaseModel):
    built_in_fields = models.JSONField(default=get_default_work_item_field_configuration)

    class Meta:
        verbose_name = "Project Work Item Field Configuration"
        verbose_name_plural = "Project Work Item Field Configurations"
        db_table = "project_work_item_field_configurations"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_work_item_field_config_project",
            )
        ]


class ProjectWorkItemProperty(ProjectBaseModel):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    property_type = models.CharField(max_length=32, choices=WorkItemPropertyType.choices)
    select_source = models.CharField(
        max_length=16,
        choices=WorkItemSelectSource.choices,
        default=WorkItemSelectSource.MANUAL,
    )
    is_required = models.BooleanField(default=False)
    default_value = models.JSONField(null=True, blank=True)
    sort_order = models.FloatField(default=65535)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Project Work Item Property"
        verbose_name_plural = "Project Work Item Properties"
        db_table = "project_work_item_properties"
        ordering = ("sort_order", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(archived_at__isnull=True, deleted_at__isnull=True),
                name="unique_active_work_item_property_name",
            )
        ]

    def __str__(self):
        return self.name


class ProjectWorkItemPropertyOption(ProjectBaseModel):
    property = models.ForeignKey(
        ProjectWorkItemProperty,
        on_delete=models.CASCADE,
        related_name="options",
    )
    name = models.CharField(max_length=255)
    sort_order = models.FloatField(default=65535)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Project Work Item Property Option"
        verbose_name_plural = "Project Work Item Property Options"
        db_table = "project_work_item_property_options"
        ordering = ("sort_order", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["property", "name"],
                condition=Q(archived_at__isnull=True, deleted_at__isnull=True),
                name="unique_active_work_item_property_option_name",
            )
        ]

    def __str__(self):
        return self.name


class WorkItemPropertyValue(ProjectBaseModel):
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.CASCADE,
        related_name="work_item_property_values",
    )
    property = models.ForeignKey(
        ProjectWorkItemProperty,
        on_delete=models.CASCADE,
        related_name="values",
    )
    value = models.JSONField()

    class Meta:
        verbose_name = "Work Item Property Value"
        verbose_name_plural = "Work Item Property Values"
        db_table = "work_item_property_values"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "property"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_work_item_property_value",
            )
        ]
