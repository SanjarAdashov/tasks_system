# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models
from django.db.models import Q

from .project import ProjectBaseModel


def get_empty_transition_condition_tree():
    return {
        "kind": "group",
        "operator": "AND",
        "children": [],
    }


class StateTransitionSourceType(models.TextChoices):
    EXACT = "EXACT", "Exact status"
    ANY = "ANY", "Any status"
    CREATE = "CREATE", "Work item creation"


class StateTransitionAuditAction(models.TextChoices):
    CONFIGURATION_CHANGED = "CONFIGURATION_CHANGED", "Configuration changed"
    TRANSITION_DENIED = "TRANSITION_DENIED", "Transition denied"


class ProjectStateTransitionSettings(ProjectBaseModel):
    strict_mode = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Project State Transition Settings"
        verbose_name_plural = "Project State Transition Settings"
        db_table = "project_state_transition_settings"
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_state_transition_settings",
            )
        ]


class ProjectStateTransitionRule(ProjectBaseModel):
    source_type = models.CharField(
        max_length=16,
        choices=StateTransitionSourceType.choices,
    )
    source_state = models.ForeignKey(
        "db.State",
        on_delete=models.CASCADE,
        related_name="outgoing_transition_rules",
        null=True,
        blank=True,
    )
    target_state = models.ForeignKey(
        "db.State",
        on_delete=models.CASCADE,
        related_name="incoming_transition_rules",
    )
    allow_conditions = models.JSONField(default=get_empty_transition_condition_tree)
    deny_conditions = models.JSONField(default=get_empty_transition_condition_tree)
    validation_conditions = models.JSONField(default=get_empty_transition_condition_tree)
    project_admin_bypass = models.BooleanField(default=False)
    system_bypass = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Project State Transition Rule"
        verbose_name_plural = "Project State Transition Rules"
        db_table = "project_state_transition_rules"
        ordering = ("created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(
                        source_type=StateTransitionSourceType.EXACT,
                        source_state__isnull=False,
                    )
                    | Q(
                        source_type__in=[
                            StateTransitionSourceType.ANY,
                            StateTransitionSourceType.CREATE,
                        ],
                        source_state__isnull=True,
                    )
                ),
                name="valid_state_transition_rule_source",
            ),
            models.UniqueConstraint(
                fields=["project", "source_state", "target_state"],
                condition=Q(
                    source_type=StateTransitionSourceType.EXACT,
                    archived_at__isnull=True,
                    deleted_at__isnull=True,
                ),
                name="unique_active_exact_state_transition",
            ),
            models.UniqueConstraint(
                fields=["project", "source_type", "target_state"],
                condition=Q(
                    source_type__in=[
                        StateTransitionSourceType.ANY,
                        StateTransitionSourceType.CREATE,
                    ],
                    archived_at__isnull=True,
                    deleted_at__isnull=True,
                ),
                name="unique_active_global_state_transition",
            ),
        ]


class ProjectStateTransitionAuditLog(ProjectBaseModel):
    action = models.CharField(
        max_length=32,
        choices=StateTransitionAuditAction.choices,
    )
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.SET_NULL,
        related_name="state_transition_audit_logs",
        null=True,
        blank=True,
    )
    rule = models.ForeignKey(
        ProjectStateTransitionRule,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
        null=True,
        blank=True,
    )
    source_state = models.ForeignKey(
        "db.State",
        on_delete=models.SET_NULL,
        related_name="source_transition_audit_logs",
        null=True,
        blank=True,
    )
    target_state = models.ForeignKey(
        "db.State",
        on_delete=models.SET_NULL,
        related_name="target_transition_audit_logs",
        null=True,
        blank=True,
    )
    details = models.JSONField(default=dict)

    class Meta:
        verbose_name = "Project State Transition Audit Log"
        verbose_name_plural = "Project State Transition Audit Logs"
        db_table = "project_state_transition_audit_logs"
        ordering = ("-created_at",)
        indexes = [
            models.Index(
                fields=["project", "action", "-created_at"],
                name="state_transition_audit_idx",
            )
        ]
