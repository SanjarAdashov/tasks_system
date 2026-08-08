# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from dataclasses import dataclass, field
from datetime import date, datetime
from uuid import UUID

from django.db.models import Q
from django.utils.html import strip_tags
from rest_framework import serializers

from plane.db.models import (
    CycleIssue,
    IssueBlocker,
    IssueRelation,
    ModuleIssue,
    Project,
    ProjectMember,
    ProjectStateTransitionAuditLog,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectUserGroupMember,
    ProjectWorkItemProperty,
    State,
    StateGroup,
    StateTransitionAuditAction,
    StateTransitionSourceType,
    WorkItemPropertyValue,
)

from .work_item_fields import MISSING


GENERIC_ACCESS_MESSAGE = "You do not have permission to perform this status transition."
STRICT_MODE_MESSAGE = "This status transition is not configured for the project."
FIELD_LABELS = {
    "name": "Title",
    "description": "Description",
    "priority": "Priority",
    "state": "Status",
    "assignees": "Assignees",
    "labels": "Labels",
    "start_date": "Start date",
    "target_date": "Due date",
    "cycle": "Cycle",
    "module": "Module",
    "estimate": "Estimate",
    "parent": "Parent work item",
    "created_by": "Creator",
    "attachments": "Attachments",
    "comments": "Comments",
    "subtasks": "Subtasks",
    "dependencies": "Dependencies",
    "actor.user": "User",
    "actor.role": "Project role",
    "actor.is_assignee": "Assignee",
    "actor.is_creator": "Creator",
    "actor.group": "User group requirement",
    "created_by.group": "User group requirement",
    "assignees.group_any": "User group requirement",
    "assignees.group_all": "User group requirement",
}


@dataclass
class StateTransitionEvaluation:
    allowed: bool
    reasons: list[str] = field(default_factory=list)
    required_fields: list[str] = field(default_factory=list)
    applied_rule_ids: list[str] = field(default_factory=list)
    code: str = "allowed"

    def as_dict(self):
        return {
            "allowed": self.allowed,
            "code": self.code,
            "reasons": self.reasons,
            "required_fields": self.required_fields,
            "applied_rule_ids": self.applied_rule_ids,
        }


def _canonical(value):
    if hasattr(value, "pk"):
        return str(value.pk)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (list, tuple, set)):
        return [_canonical(item) for item in value]
    return value


def _is_set(value):
    if value is None or value is MISSING:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _date_value(value, values):
    if isinstance(value, dict):
        value_type = value.get("type") or value.get("kind")
        if value_type == "today":
            return date.today()
        if value_type == "field":
            value = values.get(value.get("value") or value.get("field"))
        elif value_type == "literal":
            value = value.get("value")
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _ids_from_relation(value):
    if value is None or value is MISSING:
        return []
    return [_canonical(item) for item in value]


def _existing_property_values(issue):
    if not issue:
        return {}
    return {str(item.property_id): item.value for item in WorkItemPropertyValue.objects.filter(issue=issue)}


def _completion_summary(queryset):
    groups = list(queryset.values_list("state__group", flat=True))
    terminal = {StateGroup.COMPLETED.value, StateGroup.CANCELLED.value}
    return {
        "total": len(groups),
        "incomplete": sum(group not in terminal for group in groups),
    }


def _dependency_summary(issue):
    if not issue:
        return {"total": 0, "incomplete": 0}
    dependency_ids = set(IssueBlocker.objects.filter(block=issue).values_list("blocked_by_id", flat=True))
    dependency_ids.update(
        IssueRelation.objects.filter(
            issue=issue,
            relation_type="blocked_by",
        ).values_list("related_issue_id", flat=True)
    )
    from plane.db.models import Issue

    return _completion_summary(Issue.objects.filter(id__in=dependency_ids))


def build_final_issue_values(
    *,
    project,
    actor,
    issue=None,
    attrs=None,
    target_state=None,
):
    attrs = attrs or {}

    def provided(key, default=MISSING):
        return attrs[key] if key in attrs else default

    def scalar(key, instance_key=None, default=None):
        value = provided(key)
        if value is not MISSING:
            return value
        if issue:
            return getattr(issue, instance_key or key)
        return default

    description = provided("description_html")
    if description is MISSING:
        description = provided("description_stripped")
    if description is MISSING:
        description = provided("description_json")
    if description is MISSING:
        description = issue.description_html if issue else None
    if isinstance(description, str):
        description = strip_tags(description).replace("&nbsp;", " ").strip()

    assignees = provided("assignee_ids")
    if assignees is MISSING:
        assignees = provided("assignees")
    if assignees is MISSING:
        assignees = (
            list(issue.assignees.values_list("id", flat=True))
            if issue
            else ([project.default_assignee_id] if project.default_assignee_id else [])
        )
    labels = provided("label_ids")
    if labels is MISSING:
        labels = provided("labels")
    if labels is MISSING:
        labels = list(issue.labels.values_list("id", flat=True)) if issue else []
    cycle = provided("cycle_id")
    if cycle is MISSING:
        cycle = CycleIssue.objects.filter(issue=issue).values_list("cycle_id", flat=True).first() if issue else None
    modules = provided("module_ids")
    if modules is MISSING:
        modules = list(ModuleIssue.objects.filter(issue=issue).values_list("module_id", flat=True)) if issue else []
    estimate = provided("estimate_point")
    if estimate is MISSING:
        estimate = provided("point")
    if estimate is MISSING:
        estimate = issue.estimate_point_id or issue.point if issue else None
    parent = provided("parent")
    if parent is MISSING:
        parent = issue.parent_id if issue else None
    properties = attrs.get("property_values", MISSING)
    if properties is MISSING:
        properties = _existing_property_values(issue)

    values = {
        "name": scalar("name"),
        "description": description,
        "priority": scalar("priority", default="none"),
        "state": _canonical(target_state or scalar("state")),
        "assignees": _ids_from_relation(assignees),
        "labels": _ids_from_relation(labels),
        "start_date": scalar("start_date"),
        "target_date": scalar("target_date"),
        "cycle": _canonical(cycle),
        "module": _ids_from_relation(modules),
        "estimate": _canonical(estimate),
        "parent": _canonical(parent),
        "created_by": _canonical(issue.created_by_id if issue else getattr(actor, "id", None)),
        "attachments": issue.issue_attachment.count() if issue else 0,
        "comments": issue.issue_comments.count() if issue else 0,
        "subtasks": _completion_summary(issue.parent_issue.all()) if issue else {"total": 0, "incomplete": 0},
        "dependencies": _dependency_summary(issue),
    }
    for property_id, value in properties.items():
        values[f"custom:{property_id}"] = _canonical(value)
    return values


def _actor_values(*, project, actor, issue, values):
    actor_id = _canonical(getattr(actor, "id", None))
    membership = (
        ProjectMember.objects.filter(
            project=project,
            member=actor,
            is_active=True,
            member__is_active=True,
        )
        .values("role")
        .first()
        if actor_id
        else None
    )
    actor_values = {
        "actor.user": actor_id,
        "actor.role": membership["role"] if membership else None,
        "actor.is_assignee": actor_id in values["assignees"] if actor_id else False,
        "actor.is_creator": actor_id == values["created_by"] if actor_id else False,
    }
    for field_name, field_value in values.items():
        if not field_name.startswith("custom:"):
            continue
        property_id = field_name.split(":", 1)[1]
        selected = field_value if isinstance(field_value, list) else [field_value]
        actor_values[f"actor.member_property:{property_id}"] = actor_id in selected
    return actor_values, membership


def _user_group_values(*, project, actor, values):
    memberships = ProjectUserGroupMember.objects.filter(project=project).values_list("group_id", "member_id")
    groups_by_member = {}
    all_group_ids = set()
    for group_id, member_id in memberships:
        group_id = str(group_id)
        member_id = str(member_id)
        all_group_ids.add(group_id)
        groups_by_member.setdefault(member_id, set()).add(group_id)

    def member_groups(member_id):
        return sorted(groups_by_member.get(str(member_id), set())) if member_id else []

    def matching_groups(member_ids, *, require_all):
        member_ids = [str(item) for item in member_ids if item]
        if not member_ids:
            return []
        matches = []
        for group_id in all_group_ids:
            flags = [group_id in groups_by_member.get(member_id, set()) for member_id in member_ids]
            if all(flags) if require_all else any(flags):
                matches.append(group_id)
        return sorted(matches)

    group_values = {
        "actor.group": member_groups(getattr(actor, "id", None)),
        "created_by.group": member_groups(values.get("created_by")),
        "assignees.group_any": matching_groups(values.get("assignees") or [], require_all=False),
        "assignees.group_all": matching_groups(values.get("assignees") or [], require_all=True),
    }
    for field_name, selected_members in values.items():
        if not field_name.startswith("custom:"):
            continue
        property_id = field_name.split(":", 1)[1]
        selected_members = selected_members if isinstance(selected_members, list) else [selected_members]
        group_values[f"custom.group_any:{property_id}"] = matching_groups(selected_members, require_all=False)
        group_values[f"custom.group_all:{property_id}"] = matching_groups(selected_members, require_all=True)
    return group_values


def _matches_condition(node, *, values):
    field_name = node["field"]
    operator = node["operator"]
    actual = values.get(field_name)
    expected = node.get("value")

    if operator == "IS_SET":
        return _is_set(actual)
    if operator == "IS_NOT_SET":
        return not _is_set(actual)
    if operator == "ALL_COMPLETED":
        return isinstance(actual, dict) and actual.get("incomplete", 0) == 0
    if operator == "HAS_INCOMPLETE":
        return isinstance(actual, dict) and actual.get("incomplete", 0) > 0
    if operator == "BEFORE":
        left = _date_value(actual, values)
        right = _date_value(expected, values)
        return left is not None and right is not None and left < right
    if operator == "AFTER":
        left = _date_value(actual, values)
        right = _date_value(expected, values)
        return left is not None and right is not None and left > right

    actual = _canonical(actual)
    expected = _canonical(expected)
    is_group_condition = (
        field_name
        in {
            "actor.group",
            "created_by.group",
            "assignees.group_any",
            "assignees.group_all",
        }
        or field_name.startswith("custom.group_any:")
        or field_name.startswith("custom.group_all:")
    )
    if operator == "EQ" and is_group_condition:
        return expected in (actual or [])
    if operator == "NEQ" and is_group_condition:
        return expected not in (actual or [])
    if operator == "EQ":
        if isinstance(expected, list) and not isinstance(actual, list):
            return actual in expected
        return actual == expected
    if operator == "NEQ":
        if isinstance(expected, list) and not isinstance(actual, list):
            return actual not in expected
        return actual != expected
    if operator == "CONTAINS":
        if not isinstance(actual, (list, tuple, set, str)):
            return False
        if isinstance(expected, list):
            return all(item in actual for item in expected)
        return expected in actual
    if operator == "NOT_CONTAINS":
        if not isinstance(actual, (list, tuple, set, str)):
            return True
        if isinstance(expected, list):
            return all(item not in actual for item in expected)
        return expected not in actual
    return False


def _evaluate_tree(node, *, values, empty_result):
    if node.get("kind") == "condition":
        passed = _matches_condition(node, values=values)
        return passed, [] if passed else [node]

    children = node.get("children") or []
    if not children:
        return empty_result, []
    results = [_evaluate_tree(child, values=values, empty_result=empty_result) for child in children]
    if node.get("operator") == "OR":
        passed = any(result[0] for result in results)
        failures = [] if passed else [leaf for _, leaves in results for leaf in leaves]
        return passed, failures
    passed = all(result[0] for result in results)
    return passed, [leaf for child_passed, leaves in results if not child_passed for leaf in leaves]


def _condition_message(node, custom_field_labels=None):
    if node.get("message"):
        return node["message"]
    field_name = node.get("field", "")
    label = (custom_field_labels or {}).get(field_name) or FIELD_LABELS.get(field_name)
    if label is None and field_name.startswith("custom:"):
        label = "Custom field"
    if label is None and field_name.startswith("actor.member_property:"):
        label = "Member field"
    if label is None and (field_name.startswith("custom.group_any:") or field_name.startswith("custom.group_all:")):
        label = "User group requirement"
    operator = node.get("operator")
    if operator == "IS_SET":
        return f"{label} must be filled in."
    if operator == "IS_NOT_SET":
        return f"{label} must be empty."
    if operator == "ALL_COMPLETED":
        return f"All {label.lower()} must be completed."
    if operator == "HAS_INCOMPLETE":
        return f"{label} must include an incomplete work item."
    return f"{label} does not satisfy the transition requirement."


def _tree_has_conditions(tree):
    if tree.get("kind") == "condition":
        return True
    return any(_tree_has_conditions(child) for child in tree.get("children") or [])


def _applicable_rules(*, project, issue, target_state, is_creation):
    queryset = ProjectStateTransitionRule.objects.filter(
        project=project,
        target_state=target_state,
        archived_at__isnull=True,
    )
    if is_creation:
        return list(
            queryset.filter(
                source_type=StateTransitionSourceType.CREATE,
                source_state__isnull=True,
            )
        )
    if not issue or not issue.state_id:
        return []
    return list(
        queryset.filter(
            Q(
                source_type=StateTransitionSourceType.EXACT,
                source_state_id=issue.state_id,
            )
            | Q(
                source_type=StateTransitionSourceType.ANY,
                source_state__isnull=True,
            )
        )
    )


def evaluate_state_transition(
    *,
    project,
    actor,
    target_state,
    issue=None,
    attrs=None,
    is_creation=False,
    is_system=False,
    log_denial=False,
):
    if not isinstance(project, Project):
        project = Project.objects.get(id=project)
    if not isinstance(target_state, State):
        target_state = State.objects.get(id=target_state, project=project)

    rules = _applicable_rules(
        project=project,
        issue=issue,
        target_state=target_state,
        is_creation=is_creation,
    )
    settings = ProjectStateTransitionSettings.objects.filter(project=project).first()
    if not rules and settings and settings.strict_mode:
        result = StateTransitionEvaluation(
            allowed=False,
            reasons=[STRICT_MODE_MESSAGE],
            code="transition_not_configured",
        )
        if log_denial:
            _log_denial(
                project=project,
                actor=actor,
                issue=issue,
                target_state=target_state,
                result=result,
            )
        return result
    if not rules:
        return StateTransitionEvaluation(allowed=True)

    issue_values = build_final_issue_values(
        project=project,
        actor=actor,
        issue=issue,
        attrs=attrs,
        target_state=target_state,
    )
    actor_values, membership = _actor_values(
        project=project,
        actor=actor,
        issue=issue,
        values=issue_values,
    )
    group_values = _user_group_values(project=project, actor=actor, values=issue_values)
    values = {**issue_values, **actor_values, **group_values}
    is_project_admin = bool(membership and membership["role"] == 20)
    applied = []
    validation_failures = []
    access_denied = False

    for rule in rules:
        if (is_system and rule.system_bypass) or (is_project_admin and rule.project_admin_bypass):
            continue
        applied.append(str(rule.id))
        if _tree_has_conditions(rule.deny_conditions):
            deny_matches, _ = _evaluate_tree(
                rule.deny_conditions,
                values=values,
                empty_result=False,
            )
            if deny_matches:
                access_denied = True
        if _tree_has_conditions(rule.allow_conditions):
            allow_matches, _ = _evaluate_tree(
                rule.allow_conditions,
                values=values,
                empty_result=True,
            )
            if not allow_matches:
                access_denied = True
        if _tree_has_conditions(rule.validation_conditions):
            validators_pass, failures = _evaluate_tree(
                rule.validation_conditions,
                values=values,
                empty_result=True,
            )
            if not validators_pass:
                validation_failures.extend(failures)

    reasons = []
    code = "allowed"
    if access_denied:
        reasons.append(GENERIC_ACCESS_MESSAGE)
        code = "transition_forbidden"
    if validation_failures:
        custom_field_labels = {}
        for property_id, property_name in ProjectWorkItemProperty.objects.filter(project=project).values_list(
            "id", "name"
        ):
            custom_field_labels[f"custom:{property_id}"] = property_name
            custom_field_labels[f"actor.member_property:{property_id}"] = property_name
        reasons.extend(_condition_message(node, custom_field_labels) for node in validation_failures)
        if code == "allowed":
            code = "validation_failed"
    reasons = list(dict.fromkeys(reasons))
    required_fields = list(
        dict.fromkeys(node["field"] for node in validation_failures if node.get("operator") == "IS_SET")
    )
    result = StateTransitionEvaluation(
        allowed=not reasons,
        reasons=reasons,
        required_fields=required_fields,
        applied_rule_ids=applied,
        code=code,
    )
    if log_denial and not result.allowed:
        _log_denial(
            project=project,
            actor=actor,
            issue=issue,
            target_state=target_state,
            result=result,
        )
    return result


def _log_denial(*, project, actor, issue, target_state, result):
    ProjectStateTransitionAuditLog.objects.create(
        project=project,
        issue=issue,
        source_state_id=issue.state_id if issue else None,
        target_state=target_state,
        action=StateTransitionAuditAction.TRANSITION_DENIED,
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
        details={
            "code": result.code,
            "reasons": result.reasons,
            "applied_rule_ids": result.applied_rule_ids,
        },
    )


def resolve_creation_state(*, project, attrs):
    state = attrs.get("state")
    if state:
        return state
    return (
        State.objects.filter(project=project, is_triage=False, default=True).first()
        or State.objects.filter(
            project=project,
            is_triage=False,
        ).first()
    )


def enforce_state_transition(
    *,
    project,
    actor,
    issue,
    attrs,
    is_system=False,
):
    is_creation = issue is None or bool(
        issue.state_id and (issue.state.is_triage or issue.state.group == StateGroup.TRIAGE.value)
    )
    target_state = resolve_creation_state(project=project, attrs=attrs) if issue is None else attrs.get("state")
    if not target_state:
        return
    if issue and not is_creation and target_state.id == issue.state_id:
        return
    result = evaluate_state_transition(
        project=project,
        actor=actor,
        issue=issue,
        target_state=target_state,
        attrs=attrs,
        is_creation=is_creation,
        is_system=is_system,
        log_denial=True,
    )
    if not result.allowed:
        raise serializers.ValidationError({"state_transition": result.as_dict()})
