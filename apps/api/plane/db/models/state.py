# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db import transaction
from django.template.defaultfilters import slugify
from django.db.models import Q
from django.utils import timezone

# Module imports
from .project import ProjectBaseModel
from plane.db.mixins import SoftDeletionManager


class StateGroup(models.TextChoices):
    BACKLOG = "backlog", "Backlog"
    UNSTARTED = "unstarted", "Unstarted"
    STARTED = "started", "Started"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"
    TRIAGE = "triage", "Triage"


# Default states
DEFAULT_STATES = [
    {
        "name": "Backlog",
        "color": "#60646C",
        "sequence": 15000,
        "group": StateGroup.BACKLOG.value,
        "default": True,
    },
    {
        "name": "Todo",
        "color": "#60646C",
        "sequence": 25000,
        "group": StateGroup.UNSTARTED.value,
    },
    {
        "name": "In Progress",
        "color": "#F59E0B",
        "sequence": 35000,
        "group": StateGroup.STARTED.value,
    },
    {
        "name": "Done",
        "color": "#46A758",
        "sequence": 45000,
        "group": StateGroup.COMPLETED.value,
    },
    {
        "name": "Cancelled",
        "color": "#9AA4BC",
        "sequence": 55000,
        "group": StateGroup.CANCELLED.value,
    },
    {
        "name": "Triage",
        "color": "#4E5355",
        "sequence": 65000,
        "group": StateGroup.TRIAGE.value,
    },
]


class StateManager(SoftDeletionManager):
    """Default manager - excludes triage states"""

    def get_queryset(self):
        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)


class TriageStateManager(SoftDeletionManager):
    """Manager for triage states only"""

    def get_queryset(self):
        return super().get_queryset().filter(group=StateGroup.TRIAGE.value)


class State(ProjectBaseModel):
    name = models.CharField(max_length=255, verbose_name="State Name")
    description = models.TextField(verbose_name="State Description", blank=True)
    color = models.CharField(max_length=255, verbose_name="State Color")
    slug = models.SlugField(max_length=100, blank=True)
    sequence = models.FloatField(default=65535)
    group = models.CharField(
        choices=StateGroup.choices,
        default=StateGroup.BACKLOG,
        max_length=20,
    )
    is_triage = models.BooleanField(default=False)
    default = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    objects = StateManager()
    all_state_objects = models.Manager()
    triage_objects = TriageStateManager()

    def __str__(self):
        """Return name of the state"""
        return f"{self.name} <{self.project.name}>"

    class Meta:
        unique_together = ["name", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "project"],
                condition=Q(deleted_at__isnull=True),
                name="state_unique_name_project_when_deleted_at_null",
            )
        ]
        verbose_name = "State"
        verbose_name_plural = "States"
        db_table = "states"
        ordering = ("sequence",)

    def save(self, *args, **kwargs):
        self.slug = slugify(self.name)
        is_restored = False
        if not self._state.adding and self.deleted_at is None:
            previous_deleted_at = (
                State.all_state_objects.filter(pk=self.pk).values_list("deleted_at", flat=True).first()
            )
            is_restored = previous_deleted_at is not None

        if self._state.adding or is_restored:
            # Get the maximum sequence value from the database
            last_id = (
                State.objects.filter(project_id=self.project_id)
                .exclude(pk=self.pk)
                .aggregate(largest=models.Max("sequence"))["largest"]
            )
            # if last_id is not None
            if last_id is not None:
                self.sequence = last_id + 15000
            elif is_restored:
                self.sequence = 15000

        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        """
        Archive workflow rules that reference this state before the state itself
        is soft-deleted. Restoring a state intentionally does not restore rules.
        """
        from plane.db.models.state_transition import (
            ProjectStateTransitionAuditLog,
            ProjectStateTransitionRule,
            StateTransitionAuditAction,
        )

        with transaction.atomic():
            archived_at = timezone.now()
            rules = list(
                ProjectStateTransitionRule.objects.filter(
                    Q(source_state_id=self.id) | Q(target_state_id=self.id),
                    archived_at__isnull=True,
                )
            )
            if rules:
                ProjectStateTransitionRule.objects.filter(id__in=[rule.id for rule in rules]).update(
                    archived_at=archived_at
                )
                ProjectStateTransitionAuditLog.objects.bulk_create(
                    [
                        ProjectStateTransitionAuditLog(
                            workspace_id=rule.workspace_id,
                            project_id=rule.project_id,
                            action=StateTransitionAuditAction.CONFIGURATION_CHANGED,
                            rule=rule,
                            source_state_id=rule.source_state_id,
                            target_state_id=rule.target_state_id,
                            details={
                                "operation": "rule_archived_with_state",
                                "state_id": str(self.id),
                            },
                        )
                        for rule in rules
                    ]
                )
            return super().delete(*args, **kwargs)
