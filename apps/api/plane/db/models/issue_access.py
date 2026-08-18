# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models
from django.db.models import Q

from .project import ProjectBaseModel


class IssueAccessAuditAction(models.TextChoices):
    VISIBILITY_CHANGED = "VISIBILITY_CHANGED", "Visibility changed"
    GROUPS_CHANGED = "GROUPS_CHANGED", "Allowed groups changed"
    ASSIGNEES_CHANGED = "ASSIGNEES_CHANGED", "Assignees changed"
    MEMBER_PROPERTIES_CHANGED = "MEMBER_PROPERTIES_CHANGED", "Member properties changed"
    GROUP_MEMBERS_CHANGED = "GROUP_MEMBERS_CHANGED", "Group members changed"
    PARENT_ACCESS_APPLIED = "PARENT_ACCESS_APPLIED", "Parent access applied"


class IssueAccessSourceType(models.TextChoices):
    VISIBILITY = "VISIBILITY", "Visibility"
    CREATOR = "CREATOR", "Creator"
    ASSIGNEE = "ASSIGNEE", "Assignee"
    MEMBER_PROPERTY = "MEMBER_PROPERTY", "Member property"
    USER_GROUP = "USER_GROUP", "User group"
    GROUP_MEMBERSHIP = "GROUP_MEMBERSHIP", "Group membership"
    PARENT = "PARENT", "Parent"


class IssueAccessGroup(ProjectBaseModel):
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.CASCADE,
        related_name="access_group_links",
    )
    group = models.ForeignKey(
        "db.ProjectUserGroup",
        on_delete=models.CASCADE,
        related_name="issue_access_links",
    )

    class Meta:
        verbose_name = "Issue Access Group"
        verbose_name_plural = "Issue Access Groups"
        db_table = "issue_access_groups"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "group"],
                condition=Q(deleted_at__isnull=True),
                name="unique_active_issue_access_group",
            )
        ]


class IssueAccessAuditLog(ProjectBaseModel):
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.CASCADE,
        related_name="access_audit_logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="issue_access_audit_events",
    )
    action = models.CharField(max_length=48, choices=IssueAccessAuditAction.choices)
    source_type = models.CharField(max_length=32, choices=IssueAccessSourceType.choices)
    source_id = models.UUIDField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Issue Access Audit Log"
        verbose_name_plural = "Issue Access Audit Logs"
        db_table = "issue_access_audit_logs"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["issue", "created_at"], name="issue_access_audit_issue_idx"),
            models.Index(fields=["project", "created_at"], name="issue_access_audit_project_idx"),
        ]
