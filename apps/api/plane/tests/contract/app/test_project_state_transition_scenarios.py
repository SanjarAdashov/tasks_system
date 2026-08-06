# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date, timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import serializers

from plane.app.serializers.state_transition import validate_transition_condition_tree
from plane.bgtasks.issue_automation_task import close_old_issues
from plane.db.models.issue import IssueAttachment
from plane.db.models import (
    Issue,
    IssueBlocker,
    IssueComment,
    Project,
    ProjectMember,
    ProjectStateTransitionAuditLog,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectWorkItemProperty,
    State,
    User,
    WorkItemPropertyValue,
    WorkspaceMember,
)
from plane.utils.state_transition_rules import enforce_state_transition, evaluate_state_transition


def condition(field, operator, value=None, message=None):
    node = {
        "kind": "condition",
        "field": field,
        "operator": operator,
    }
    if value is not None:
        node["value"] = value
    if message:
        node["message"] = message
    return node


def group(operator, *children):
    return {
        "kind": "group",
        "operator": operator,
        "children": list(children),
    }


@pytest.fixture
def workflow_project(workspace, create_user):
    project = Project.objects.create(
        name="Workflow scenario matrix",
        identifier="WFQA",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


@pytest.fixture
def workflow_states(workflow_project):
    return {
        "todo": State.objects.create(
            project=workflow_project,
            name="Todo",
            color="#111111",
            group="unstarted",
            default=True,
        ),
        "doing": State.objects.create(
            project=workflow_project,
            name="Doing",
            color="#222222",
            group="started",
        ),
        "review": State.objects.create(
            project=workflow_project,
            name="Review",
            color="#333333",
            group="started",
        ),
        "done": State.objects.create(
            project=workflow_project,
            name="Done",
            color="#444444",
            group="completed",
        ),
        "cancelled": State.objects.create(
            project=workflow_project,
            name="Cancelled",
            color="#555555",
            group="cancelled",
        ),
    }


@pytest.fixture
def regular_actor(workspace, workflow_project):
    actor = User.objects.create_user(
        email=f"workflow-actor-{uuid4()}@plane.so",
        username=f"workflow-actor-{uuid4()}",
        password="test-password",
    )
    WorkspaceMember.objects.create(
        workspace=workspace,
        member=actor,
        role=15,
        is_active=True,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=workflow_project,
        member=actor,
        role=15,
        is_active=True,
    )
    return actor


@pytest.fixture
def workflow_issue(workflow_project, workflow_states, create_user):
    return Issue.objects.create(
        project=workflow_project,
        state=workflow_states["todo"],
        name="Scenario work item",
        priority="medium",
        created_by=create_user,
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestStateTransitionOperatorMatrix:
    @pytest.mark.parametrize(
        ("rule_condition", "attrs", "expected"),
        [
            (condition("name", "IS_SET"), {"name": "Ready"}, True),
            (condition("name", "IS_SET"), {"name": "   "}, False),
            (condition("description", "IS_NOT_SET"), {"description_html": "<p>&nbsp;</p>"}, True),
            (condition("priority", "EQ", ["high", "urgent"]), {"priority": "high"}, True),
            (condition("priority", "NEQ", ["high", "urgent"]), {"priority": "low"}, True),
            (condition("start_date", "BEFORE", "2026-08-10"), {"start_date": "2026-08-09"}, True),
            (condition("start_date", "BEFORE", "not-a-date"), {"start_date": "2026-08-09"}, False),
            (
                condition("target_date", "AFTER", {"type": "field", "value": "start_date"}),
                {"start_date": "2026-08-09", "target_date": "2026-08-10"},
                True,
            ),
            (
                condition("target_date", "AFTER", {"type": "literal", "value": "2026-08-10"}),
                {"target_date": "2026-08-09"},
                False,
            ),
            (condition("assignees", "CONTAINS", ["actor-id", "reviewer-id"]), {"assignee_ids": ["actor-id"]}, False),
            (condition("assignees", "CONTAINS", "actor-id"), {"assignee_ids": ["actor-id"]}, True),
            (condition("labels", "NOT_CONTAINS", "blocked-label"), {"label_ids": ["ready-label"]}, True),
            (condition("module", "CONTAINS", ["module-a", "module-b"]), {"module_ids": ["module-a", "module-b"]}, True),
            (condition("cycle", "EQ", "cycle-a"), {"cycle_id": "cycle-a"}, True),
            (condition("parent", "EQ", "parent-a"), {"parent": "parent-a"}, True),
            (condition("estimate", "EQ", 5), {"point": 5}, True),
            (condition("state", "EQ", "not-the-target"), {}, False),
        ],
    )
    def test_operator_matrix_against_final_proposed_values(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
        rule_condition,
        attrs,
        expected,
    ):
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
            validation_conditions=rule_condition,
        )

        result = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs=attrs,
        )

        assert result.allowed is expected

    def test_today_date_operand_is_supported(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
            validation_conditions=condition("target_date", "AFTER", {"type": "today"}),
        )

        result = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={"target_date": date.today() + timedelta(days=1)},
        )

        assert result.allowed is True

    def test_nested_and_or_groups_use_all_and_any_semantics(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
            validation_conditions=group(
                "AND",
                condition("name", "IS_SET"),
                group(
                    "OR",
                    condition("priority", "EQ", "urgent"),
                    condition("target_date", "IS_SET"),
                ),
            ),
        )

        no_or_branch = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={"name": "Ready", "priority": "low", "target_date": None},
        )
        urgent_branch = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={"name": "Ready", "priority": "urgent", "target_date": None},
        )
        date_branch = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={"name": "Ready", "priority": "low", "target_date": "2026-08-10"},
        )

        assert no_or_branch.allowed is False
        assert urgent_branch.allowed is True
        assert date_branch.allowed is True


@pytest.mark.contract
@pytest.mark.django_db
class TestStateTransitionActorsAndCustomProperties:
    def test_user_role_creator_and_final_assignee_conditions(
        self,
        create_user,
        regular_actor,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
            allow_conditions=group(
                "AND",
                condition("actor.user", "EQ", str(regular_actor.id)),
                condition("actor.role", "EQ", 15),
                condition("actor.is_assignee", "EQ", True),
                condition("actor.is_creator", "EQ", False),
            ),
        )

        denied = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
        )
        allowed = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={"assignees": [regular_actor]},
        )

        assert denied.code == "transition_forbidden"
        assert denied.reasons == ["You do not have permission to perform this status transition."]
        assert allowed.allowed is True

    def test_member_backed_property_and_named_custom_validation_use_current_values(
        self,
        create_user,
        regular_actor,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        reviewers = ProjectWorkItemProperty.objects.create(
            project=workflow_project,
            name="Reviewers",
            property_type="MULTI_SELECT",
            select_source="MEMBERS",
        )
        approval = ProjectWorkItemProperty.objects.create(
            project=workflow_project,
            name="Approval note",
            property_type="SHORT_TEXT",
        )
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
            allow_conditions=condition(
                f"actor.member_property:{reviewers.id}",
                "EQ",
                True,
            ),
            validation_conditions=condition(f"custom:{approval.id}", "IS_SET"),
        )

        access_denied = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={
                "property_values": {
                    str(reviewers.id): [],
                    str(approval.id): "Approved",
                }
            },
        )
        validation_denied = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={
                "property_values": {
                    str(reviewers.id): [str(regular_actor.id)],
                    str(approval.id): "",
                }
            },
        )
        proposed_allowed = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
            attrs={
                "property_values": {
                    str(reviewers.id): [str(regular_actor.id)],
                    str(approval.id): "Approved",
                }
            },
        )

        WorkItemPropertyValue.objects.create(
            project=workflow_project,
            issue=workflow_issue,
            property=reviewers,
            value=[str(regular_actor.id)],
        )
        WorkItemPropertyValue.objects.create(
            project=workflow_project,
            issue=workflow_issue,
            property=approval,
            value="Persisted approval",
        )
        persisted_allowed = evaluate_state_transition(
            project=workflow_project,
            actor=regular_actor,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
        )

        assert access_denied.code == "transition_forbidden"
        assert validation_denied.code == "validation_failed"
        assert validation_denied.reasons == ["Approval note must be filled in."]
        assert proposed_allowed.allowed is True
        assert persisted_allowed.allowed is True


@pytest.mark.contract
@pytest.mark.django_db
class TestStateTransitionRelationsAndDirection:
    def test_comments_attachments_subtasks_and_dependencies(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        subtask = Issue.objects.create(
            project=workflow_project,
            state=workflow_states["doing"],
            parent=workflow_issue,
            name="Incomplete subtask",
            created_by=create_user,
        )
        dependency = Issue.objects.create(
            project=workflow_project,
            state=workflow_states["doing"],
            name="Incomplete dependency",
            created_by=create_user,
        )
        IssueBlocker.objects.create(
            project=workflow_project,
            block=workflow_issue,
            blocked_by=dependency,
        )
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["review"],
            validation_conditions=group(
                "AND",
                condition("attachments", "EQ", 1),
                condition("comments", "EQ", 1),
                condition("subtasks", "ALL_COMPLETED"),
                condition("dependencies", "ALL_COMPLETED"),
            ),
        )

        initial = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["review"],
        )
        IssueAttachment.objects.create(
            project=workflow_project,
            issue=workflow_issue,
            asset="attachments/workflow-check.txt",
        )
        IssueComment.objects.create(
            project=workflow_project,
            issue=workflow_issue,
            actor=create_user,
            comment_html="<p>Reviewed</p>",
        )
        subtask.state = workflow_states["done"]
        subtask.save()
        dependency.state = workflow_states["cancelled"]
        dependency.save()
        completed = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["review"],
        )

        assert initial.allowed is False
        assert "All subtasks must be completed." in initial.reasons
        assert "All dependencies must be completed." in initial.reasons
        assert completed.allowed is True

    def test_has_incomplete_operator_detects_relations(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        Issue.objects.create(
            project=workflow_project,
            state=workflow_states["doing"],
            parent=workflow_issue,
            name="Still open",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["review"],
            validation_conditions=condition("subtasks", "HAS_INCOMPLETE"),
        )

        result = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["review"],
        )

        assert result.allowed is True

    def test_reverse_transition_is_independent_and_same_state_is_a_noop(
        self,
        create_user,
        workflow_project,
        workflow_states,
        workflow_issue,
    ):
        ProjectStateTransitionSettings.objects.create(project=workflow_project, strict_mode=True)
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["doing"],
        )

        forward = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["doing"],
        )
        workflow_issue.state = workflow_states["doing"]
        workflow_issue.save()
        reverse = evaluate_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            target_state=workflow_states["todo"],
            log_denial=True,
        )
        enforce_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=workflow_issue,
            attrs={"state": workflow_states["doing"]},
        )

        assert forward.allowed is True
        assert reverse.code == "transition_not_configured"
        assert (
            ProjectStateTransitionAuditLog.objects.filter(
                project=workflow_project,
                action="TRANSITION_DENIED",
            ).count()
            == 1
        )

    def test_creation_uses_default_state_and_strict_creation_rule(
        self,
        create_user,
        workflow_project,
        workflow_states,
    ):
        ProjectStateTransitionSettings.objects.create(project=workflow_project, strict_mode=True)
        ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="CREATE",
            target_state=workflow_states["todo"],
            validation_conditions=condition("name", "IS_SET"),
        )

        enforce_state_transition(
            project=workflow_project,
            actor=create_user,
            issue=None,
            attrs={"name": "Created in the default state"},
        )
        with pytest.raises(serializers.ValidationError) as error:
            enforce_state_transition(
                project=workflow_project,
                actor=create_user,
                issue=None,
                attrs={"name": ""},
            )

        assert error.value.detail["state_transition"]["code"] == "validation_failed"


@pytest.mark.contract
@pytest.mark.django_db
class TestStateTransitionAutomationAndSchema:
    def test_automatic_close_is_partial_and_system_bypass_is_per_rule(
        self,
        mocker,
        create_user,
        workflow_project,
        workflow_states,
    ):
        workflow_project.close_in = 1
        workflow_project.default_state = workflow_states["cancelled"]
        workflow_project.save(update_fields=["close_in", "default_state", "updated_at"])
        allowed_issue = Issue.objects.create(
            project=workflow_project,
            state=workflow_states["todo"],
            name="Automation allowed",
            target_date=date.today(),
            created_by=create_user,
        )
        denied_issue = Issue.objects.create(
            project=workflow_project,
            state=workflow_states["todo"],
            name="Automation denied",
            created_by=create_user,
        )
        old_timestamp = timezone.now() - timedelta(days=40)
        Issue.issue_objects.filter(id__in=[allowed_issue.id, denied_issue.id]).update(updated_at=old_timestamp)
        rule = ProjectStateTransitionRule.objects.create(
            project=workflow_project,
            source_type="EXACT",
            source_state=workflow_states["todo"],
            target_state=workflow_states["cancelled"],
            validation_conditions=condition("target_date", "IS_SET"),
            system_bypass=False,
        )
        activity_delay = mocker.patch("plane.bgtasks.issue_automation_task.issue_activity.delay")

        close_old_issues()
        allowed_issue.refresh_from_db()
        denied_issue.refresh_from_db()

        assert allowed_issue.state_id == workflow_states["cancelled"].id
        assert denied_issue.state_id == workflow_states["todo"].id
        assert activity_delay.call_count == 1
        assert ProjectStateTransitionAuditLog.objects.filter(
            issue=denied_issue,
            action="TRANSITION_DENIED",
        ).exists()

        rule.system_bypass = True
        rule.save(update_fields=["system_bypass", "updated_at"])
        close_old_issues()
        denied_issue.refresh_from_db()

        assert denied_issue.state_id == workflow_states["cancelled"].id
        assert activity_delay.call_count == 2

    @pytest.mark.parametrize(
        "tree",
        [
            "not-an-object",
            {"kind": "group", "operator": "XOR", "children": []},
            {"kind": "group", "operator": "AND", "children": "not-a-list"},
            {"kind": "unknown"},
            {"kind": "condition", "field": "", "operator": "EQ", "value": "x"},
            {"kind": "condition", "field": "name", "operator": "UNKNOWN"},
            {"kind": "condition", "field": "unsupported", "operator": "EQ", "value": "x"},
            {"kind": "condition", "field": "name", "operator": "EQ"},
            {"kind": "condition", "field": "actor.user", "operator": "EQ", "value": "not-a-uuid"},
            {"kind": "condition", "field": "actor.role", "operator": "EQ", "value": 10},
            {"kind": "condition", "field": "custom:not-a-uuid", "operator": "IS_SET"},
            {
                "kind": "condition",
                "field": "actor.member_property:not-a-uuid",
                "operator": "EQ",
                "value": True,
            },
        ],
    )
    def test_invalid_condition_schemas_are_rejected(self, workflow_project, tree):
        with pytest.raises(serializers.ValidationError):
            validate_transition_condition_tree(tree, project=workflow_project)

    def test_condition_depth_and_node_limits_are_enforced(self, workflow_project):
        too_deep = condition("name", "IS_SET")
        for _ in range(9):
            too_deep = group("AND", too_deep)
        too_many = group("AND", *(condition("name", "IS_SET") for _ in range(201)))

        with pytest.raises(serializers.ValidationError):
            validate_transition_condition_tree(too_deep, project=workflow_project)
        with pytest.raises(serializers.ValidationError):
            validate_transition_condition_tree(too_many, project=workflow_project)

    def test_actor_user_schema_accepts_only_active_project_members(
        self,
        regular_actor,
        workflow_project,
    ):
        valid = validate_transition_condition_tree(
            condition("actor.user", "EQ", [str(regular_actor.id)]),
            project=workflow_project,
        )
        outsider = User.objects.create_user(
            email=f"workflow-outsider-{uuid4()}@plane.so",
            username=f"workflow-outsider-{uuid4()}",
            password="test-password",
        )

        with pytest.raises(serializers.ValidationError):
            validate_transition_condition_tree(
                condition("actor.user", "EQ", str(outsider.id)),
                project=workflow_project,
            )

        assert valid["value"] == [str(regular_actor.id)]
