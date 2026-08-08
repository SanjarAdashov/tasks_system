# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID

from crum import get_current_user
from rest_framework import serializers

from plane.db.models import (
    ProjectMember,
    ProjectStateTransitionAuditLog,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectUserGroup,
    ProjectWorkItemProperty,
    StateTransitionAuditAction,
    StateTransitionSourceType,
)

from .base import BaseSerializer


CONDITION_GROUP_OPERATORS = {"AND", "OR"}
CONDITION_OPERATORS = {
    "IS_SET",
    "IS_NOT_SET",
    "EQ",
    "NEQ",
    "BEFORE",
    "AFTER",
    "CONTAINS",
    "NOT_CONTAINS",
    "ALL_COMPLETED",
    "HAS_INCOMPLETE",
}
BUILT_IN_TRANSITION_FIELDS = {
    "name",
    "description",
    "priority",
    "state",
    "assignees",
    "labels",
    "start_date",
    "target_date",
    "cycle",
    "module",
    "estimate",
    "parent",
    "created_by",
    "attachments",
    "comments",
    "subtasks",
    "dependencies",
}
ACTOR_TRANSITION_FIELDS = {
    "actor.user",
    "actor.role",
    "actor.is_assignee",
    "actor.is_creator",
}
GROUP_TRANSITION_FIELDS = {
    "actor.group",
    "created_by.group",
    "assignees.group_any",
    "assignees.group_all",
}
MAX_CONDITION_DEPTH = 8
MAX_CONDITION_NODES = 200


def _get_audit_actor(serializer):
    request = serializer.context.get("request")
    actor = request.user if request else get_current_user()
    return actor if getattr(actor, "is_authenticated", False) else None


def _referenced_group_ids(tree):
    if not isinstance(tree, dict):
        return set()
    if tree.get("kind") == "condition":
        field = tree.get("field", "")
        if (
            field in GROUP_TRANSITION_FIELDS
            or field.startswith("custom.group_any:")
            or field.startswith("custom.group_all:")
        ):
            return {str(tree.get("value"))}
        return set()
    return set().union(*(_referenced_group_ids(child) for child in tree.get("children") or []), set())


def validate_transition_condition_tree(value, *, project, allow_archived_group_ids=None):
    if not isinstance(value, dict):
        raise serializers.ValidationError("Condition tree must be an object.")

    counter = {"nodes": 0}

    def validate_node(node, depth):
        counter["nodes"] += 1
        if counter["nodes"] > MAX_CONDITION_NODES:
            raise serializers.ValidationError(f"A condition tree cannot contain more than {MAX_CONDITION_NODES} nodes.")
        if depth > MAX_CONDITION_DEPTH:
            raise serializers.ValidationError(
                f"Condition groups cannot be nested deeper than {MAX_CONDITION_DEPTH} levels."
            )
        if not isinstance(node, dict):
            raise serializers.ValidationError("Every condition node must be an object.")

        kind = node.get("kind")
        if kind == "group":
            operator = node.get("operator")
            children = node.get("children")
            if operator not in CONDITION_GROUP_OPERATORS:
                raise serializers.ValidationError("Condition group operator must be AND or OR.")
            if not isinstance(children, list):
                raise serializers.ValidationError("Condition group children must be a list.")
            normalized = {
                "kind": "group",
                "operator": operator,
                "children": [validate_node(child, depth + 1) for child in children],
            }
            if node.get("id"):
                normalized["id"] = str(node["id"])
            return normalized

        if kind != "condition":
            raise serializers.ValidationError("Condition node kind must be group or condition.")

        field = node.get("field")
        operator = node.get("operator")
        if not isinstance(field, str) or not field:
            raise serializers.ValidationError("A condition field is required.")
        if operator not in CONDITION_OPERATORS:
            raise serializers.ValidationError(f"Unsupported condition operator: {operator}.")

        if field.startswith("custom.group_any:") or field.startswith("custom.group_all:"):
            try:
                property_id = UUID(field.rsplit(":", 1)[1])
            except (ValueError, TypeError) as error:
                raise serializers.ValidationError("Group member fields must contain a valid property UUID.") from error
            if not ProjectWorkItemProperty.all_objects.filter(
                id=property_id,
                project=project,
                property_type__in=["SINGLE_SELECT", "MULTI_SELECT"],
                select_source="MEMBERS",
                deleted_at__isnull=True,
            ).exists():
                raise serializers.ValidationError("Group conditions require a member-backed project property.")
        elif field.startswith("custom:"):
            try:
                property_id = UUID(field.split(":", 1)[1])
            except (ValueError, TypeError) as error:
                raise serializers.ValidationError(
                    "Custom condition fields must contain a valid property UUID."
                ) from error
            if not ProjectWorkItemProperty.all_objects.filter(
                id=property_id,
                project=project,
                deleted_at__isnull=True,
            ).exists():
                raise serializers.ValidationError("Custom condition property does not belong to this project.")
        elif field.startswith("actor.member_property:"):
            try:
                property_id = UUID(field.split(":", 1)[1])
            except (ValueError, TypeError) as error:
                raise serializers.ValidationError("Actor member fields must contain a valid property UUID.") from error
            if not ProjectWorkItemProperty.all_objects.filter(
                id=property_id,
                project=project,
                property_type__in=["SINGLE_SELECT", "MULTI_SELECT"],
                select_source="MEMBERS",
                deleted_at__isnull=True,
            ).exists():
                raise serializers.ValidationError("Actor member property is not a member-backed project property.")
        elif field not in BUILT_IN_TRANSITION_FIELDS | ACTOR_TRANSITION_FIELDS | GROUP_TRANSITION_FIELDS:
            raise serializers.ValidationError(f"Unsupported condition field: {field}.")

        value_required = operator not in {
            "IS_SET",
            "IS_NOT_SET",
            "ALL_COMPLETED",
            "HAS_INCOMPLETE",
        }
        if value_required and "value" not in node:
            raise serializers.ValidationError(f"Operator {operator} requires a value.")

        if field == "actor.user" and "value" in node:
            values = node["value"] if isinstance(node["value"], list) else [node["value"]]
            try:
                member_ids = [UUID(str(item)) for item in values]
            except (ValueError, TypeError) as error:
                raise serializers.ValidationError("Actor users must be valid user UUIDs.") from error
            if ProjectMember.objects.filter(
                project=project,
                member_id__in=member_ids,
                is_active=True,
                member__is_active=True,
            ).values("member_id").distinct().count() != len(set(member_ids)):
                raise serializers.ValidationError("Every actor user must be an active project member.")

        if field == "actor.role" and "value" in node:
            values = node["value"] if isinstance(node["value"], list) else [node["value"]]
            if any(value not in {5, 15, 20} for value in values):
                raise serializers.ValidationError("Actor role must be Guest, Member, or Project Admin.")

        if (
            field in GROUP_TRANSITION_FIELDS
            or field.startswith("custom.group_any:")
            or field.startswith("custom.group_all:")
        ):
            try:
                group_id = UUID(str(node.get("value")))
            except (ValueError, TypeError) as error:
                raise serializers.ValidationError("A valid project user group is required.") from error
            groups = ProjectUserGroup.objects.filter(id=group_id, project=project)
            if str(group_id) in (allow_archived_group_ids or set()):
                groups = ProjectUserGroup.all_objects.filter(
                    id=group_id,
                    project=project,
                    deleted_at__isnull=True,
                )
            if not groups.exists():
                raise serializers.ValidationError("The selected active user group does not belong to this project.")

        normalized = {
            "kind": "condition",
            "field": field,
            "operator": operator,
        }
        if "value" in node:
            normalized["value"] = node["value"]
        if node.get("message"):
            normalized["message"] = str(node["message"]).strip()[:1000]
        if node.get("id"):
            normalized["id"] = str(node["id"])
        return normalized

    return validate_node(value, 1)


class ProjectStateTransitionSettingsSerializer(BaseSerializer):
    class Meta:
        model = ProjectStateTransitionSettings
        fields = [
            "id",
            "project",
            "workspace",
            "strict_mode",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "project", "workspace", "created_at", "updated_at"]

    def update(self, instance, validated_data):
        before = {"strict_mode": instance.strict_mode}
        instance = super().update(instance, validated_data)
        if before["strict_mode"] != instance.strict_mode:
            ProjectStateTransitionAuditLog.objects.create(
                project=instance.project,
                action=StateTransitionAuditAction.CONFIGURATION_CHANGED,
                created_by=_get_audit_actor(self),
                details={
                    "operation": "settings_updated",
                    "before": before,
                    "after": {"strict_mode": instance.strict_mode},
                },
            )
        return instance


class ProjectStateTransitionRuleSerializer(BaseSerializer):
    class Meta:
        model = ProjectStateTransitionRule
        fields = [
            "id",
            "project",
            "workspace",
            "source_type",
            "source_state",
            "target_state",
            "allow_conditions",
            "deny_conditions",
            "validation_conditions",
            "project_admin_bypass",
            "system_bypass",
            "archived_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "workspace",
            "archived_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        project = self.context["project"]
        source_type = attrs.get(
            "source_type",
            self.instance.source_type if self.instance else None,
        )
        source_state = attrs.get(
            "source_state",
            self.instance.source_state if self.instance else None,
        )
        target_state = attrs.get(
            "target_state",
            self.instance.target_state if self.instance else None,
        )

        if source_type == StateTransitionSourceType.EXACT and source_state is None:
            raise serializers.ValidationError({"source_state": "Exact transitions require a source state."})
        if (
            source_type in {StateTransitionSourceType.ANY, StateTransitionSourceType.CREATE}
            and source_state is not None
        ):
            raise serializers.ValidationError(
                {"source_state": "Global and creation transitions cannot have a source state."}
            )
        if source_state and source_state.project_id != project.id:
            raise serializers.ValidationError({"source_state": "Source state does not belong to this project."})
        if target_state is None or target_state.project_id != project.id:
            raise serializers.ValidationError({"target_state": "Target state does not belong to this project."})
        if source_state and source_state.id == target_state.id:
            raise serializers.ValidationError({"target_state": "Source and target states must be different."})
        if source_state and (source_state.deleted_at or source_state.is_triage):
            raise serializers.ValidationError({"source_state": "Source state must be an active non-triage state."})
        if target_state.deleted_at or target_state.is_triage:
            raise serializers.ValidationError({"target_state": "Target state must be an active non-triage state."})

        duplicates = ProjectStateTransitionRule.objects.filter(
            project=project,
            source_type=source_type,
            target_state=target_state,
            archived_at__isnull=True,
        )
        if source_type == StateTransitionSourceType.EXACT:
            duplicates = duplicates.filter(source_state=source_state)
        else:
            duplicates = duplicates.filter(source_state__isnull=True)
        if self.instance:
            duplicates = duplicates.exclude(id=self.instance.id)
        if duplicates.exists():
            raise serializers.ValidationError("An active rule for this transition already exists.")

        archived_group_ids = set()
        if self.instance:
            for tree in (
                self.instance.allow_conditions,
                self.instance.deny_conditions,
                self.instance.validation_conditions,
            ):
                archived_group_ids.update(_referenced_group_ids(tree))

        for field_name in (
            "allow_conditions",
            "deny_conditions",
            "validation_conditions",
        ):
            tree = attrs.get(
                field_name,
                getattr(self.instance, field_name) if self.instance else None,
            )
            attrs[field_name] = validate_transition_condition_tree(
                tree,
                project=project,
                allow_archived_group_ids=archived_group_ids,
            )
        return attrs

    @staticmethod
    def _snapshot(instance):
        return {
            "source_type": instance.source_type,
            "source_state": str(instance.source_state_id) if instance.source_state_id else None,
            "target_state": str(instance.target_state_id),
            "allow_conditions": instance.allow_conditions,
            "deny_conditions": instance.deny_conditions,
            "validation_conditions": instance.validation_conditions,
            "project_admin_bypass": instance.project_admin_bypass,
            "system_bypass": instance.system_bypass,
            "archived_at": instance.archived_at.isoformat() if instance.archived_at else None,
        }

    def create(self, validated_data):
        instance = super().create(validated_data)
        ProjectStateTransitionAuditLog.objects.create(
            project=instance.project,
            action=StateTransitionAuditAction.CONFIGURATION_CHANGED,
            rule=instance,
            source_state=instance.source_state,
            target_state=instance.target_state,
            created_by=_get_audit_actor(self),
            details={
                "operation": "rule_created",
                "after": self._snapshot(instance),
            },
        )
        return instance

    def update(self, instance, validated_data):
        before = self._snapshot(instance)
        instance = super().update(instance, validated_data)
        ProjectStateTransitionAuditLog.objects.create(
            project=instance.project,
            action=StateTransitionAuditAction.CONFIGURATION_CHANGED,
            rule=instance,
            source_state=instance.source_state,
            target_state=instance.target_state,
            created_by=_get_audit_actor(self),
            details={
                "operation": "rule_updated",
                "before": before,
                "after": self._snapshot(instance),
            },
        )
        return instance


class ProjectStateTransitionAuditLogSerializer(BaseSerializer):
    actor_id = serializers.UUIDField(source="created_by_id", read_only=True)

    class Meta:
        model = ProjectStateTransitionAuditLog
        fields = [
            "id",
            "action",
            "issue",
            "rule",
            "source_state",
            "target_state",
            "details",
            "actor_id",
            "created_at",
        ]
        read_only_fields = fields
