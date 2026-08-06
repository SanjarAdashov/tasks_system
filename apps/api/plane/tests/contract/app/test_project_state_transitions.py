# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    DraftIssue,
    Issue,
    Project,
    ProjectMember,
    ProjectStateTransitionAuditLog,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    State,
    User,
    WorkspaceMember,
)
from plane.utils.state_transition_rules import evaluate_state_transition


def _settings_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/state-transitions/settings/"


def _rules_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/state-transitions/rules/"


def _rule_url(workspace, project, rule_id):
    return f"{_rules_url(workspace, project)}{rule_id}/"


def _audit_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/state-transitions/audit-logs/"


def _preview_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/state-transitions/preview/"


def _available_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/state-transitions/available/"


def _issue_url(workspace, project, issue_id=None):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/"
    return f"{base}{issue_id}/" if issue_id else base


def _external_issue_url(workspace, project, issue_id):
    return f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue_id}/"


def _draft_conversion_url(workspace, draft):
    return f"/api/workspaces/{workspace.slug}/draft-to-issue/{draft.id}/"


def _empty_tree():
    return {"kind": "group", "operator": "AND", "children": []}


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Transition rules",
        identifier="FLOW",
        workspace=workspace,
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
def project_states(project):
    return [
        State.objects.create(project=project, name="Todo", color="#111111", group="unstarted"),
        State.objects.create(project=project, name="Doing", color="#222222", group="started"),
        State.objects.create(project=project, name="Done", color="#333333", group="completed"),
    ]


@pytest.fixture
def project_member_client(workspace, project):
    member = User.objects.create_user(
        email="workflow-member@plane.so",
        username="workflow-member",
        password="test-password",
    )
    WorkspaceMember.objects.create(
        workspace=workspace,
        member=member,
        role=15,
        is_active=True,
    )
    ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=member,
        role=15,
        is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=member)
    return client


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectStateTransitionConfiguration:
    def test_project_admin_can_toggle_strict_mode_and_change_is_audited(
        self,
        session_client,
        create_user,
        workspace,
        project,
    ):
        get_response = session_client.get(_settings_url(workspace, project))
        assert get_response.status_code == status.HTTP_200_OK
        assert get_response.data["strict_mode"] is False

        response = session_client.patch(
            _settings_url(workspace, project),
            {"strict_mode": True},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["strict_mode"] is True
        log = ProjectStateTransitionAuditLog.objects.get(project=project)
        assert log.created_by_id == create_user.id
        assert log.details["operation"] == "settings_updated"
        assert log.details["before"]["strict_mode"] is False
        assert log.details["after"]["strict_mode"] is True

    def test_regular_member_can_read_but_cannot_change_configuration(
        self,
        project_member_client,
        workspace,
        project,
        project_states,
    ):
        assert project_member_client.get(_settings_url(workspace, project)).status_code == status.HTTP_200_OK
        assert (
            project_member_client.patch(
                _settings_url(workspace, project),
                {"strict_mode": True},
                format="json",
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            project_member_client.post(
                _rules_url(workspace, project),
                {
                    "source_type": "EXACT",
                    "source_state": str(project_states[0].id),
                    "target_state": str(project_states[1].id),
                    "allow_conditions": _empty_tree(),
                    "deny_conditions": _empty_tree(),
                    "validation_conditions": _empty_tree(),
                },
                format="json",
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )

    def test_admin_can_create_nested_exact_rule_and_duplicate_is_rejected(
        self,
        session_client,
        workspace,
        project,
        project_states,
    ):
        allow_tree = {
            "kind": "group",
            "operator": "OR",
            "children": [
                {
                    "kind": "condition",
                    "field": "actor.role",
                    "operator": "EQ",
                    "value": 20,
                },
                {
                    "kind": "group",
                    "operator": "AND",
                    "children": [
                        {
                            "kind": "condition",
                            "field": "actor.is_assignee",
                            "operator": "EQ",
                            "value": True,
                        },
                        {
                            "kind": "condition",
                            "field": "description",
                            "operator": "IS_SET",
                            "message": "Add a description before moving the work item.",
                        },
                    ],
                },
            ],
        }
        payload = {
            "source_type": "EXACT",
            "source_state": str(project_states[0].id),
            "target_state": str(project_states[1].id),
            "allow_conditions": allow_tree,
            "deny_conditions": _empty_tree(),
            "validation_conditions": _empty_tree(),
            "project_admin_bypass": False,
            "system_bypass": True,
        }

        response = session_client.post(
            _rules_url(workspace, project),
            payload,
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["allow_conditions"] == allow_tree
        assert response.data["system_bypass"] is True
        assert ProjectStateTransitionAuditLog.objects.filter(
            project=project,
            details__operation="rule_created",
        ).exists()

        duplicate_response = session_client.post(
            _rules_url(workspace, project),
            payload,
            format="json",
        )
        assert duplicate_response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize("source_type", ["ANY", "CREATE"])
    def test_admin_can_create_global_rule_without_source(
        self,
        source_type,
        session_client,
        workspace,
        project,
        project_states,
    ):
        response = session_client.post(
            _rules_url(workspace, project),
            {
                "source_type": source_type,
                "source_state": None,
                "target_state": str(project_states[2].id),
                "allow_conditions": _empty_tree(),
                "deny_conditions": _empty_tree(),
                "validation_conditions": _empty_tree(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["source_state"] is None

    def test_cross_project_state_is_rejected(
        self,
        session_client,
        workspace,
        project,
        project_states,
    ):
        other_project = Project.objects.create(
            name="Other",
            identifier="OTHER",
            workspace=workspace,
        )
        other_state = State.objects.create(
            project=other_project,
            name="Other state",
            color="#444444",
            group="started",
        )

        response = session_client.post(
            _rules_url(workspace, project),
            {
                "source_type": "EXACT",
                "source_state": str(project_states[0].id),
                "target_state": str(other_state.id),
                "allow_conditions": _empty_tree(),
                "deny_conditions": _empty_tree(),
                "validation_conditions": _empty_tree(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "target_state" in response.data

    def test_archiving_rule_keeps_history_and_state_delete_archives_related_rules(
        self,
        session_client,
        workspace,
        project,
        project_states,
    ):
        first_rule = ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
        )
        response = session_client.delete(_rule_url(workspace, project, first_rule.id))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        first_rule.refresh_from_db()
        assert first_rule.archived_at is not None

        related_rule = ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="ANY",
            target_state=project_states[2],
        )
        project_states[2].delete()
        related_rule.refresh_from_db()
        assert related_rule.archived_at is not None
        assert ProjectStateTransitionAuditLog.objects.filter(
            project=project,
            rule=related_rule,
            details__operation="rule_archived_with_state",
        ).exists()

        audit_response = session_client.get(_audit_url(workspace, project))
        assert audit_response.status_code == status.HTTP_200_OK
        assert len(audit_response.data) >= 2


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectStateTransitionEngine:
    def test_permissive_mode_allows_unconfigured_transition(
        self,
        create_user,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Permissive",
            created_by=create_user,
        )

        result = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
        )

        assert result.allowed is True
        assert result.applied_rule_ids == []

    def test_strict_mode_rejects_unconfigured_transition_and_logs_attempt(
        self,
        create_user,
        project,
        project_states,
    ):
        ProjectStateTransitionSettings.objects.create(project=project, strict_mode=True)
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Strict",
            created_by=create_user,
        )

        result = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
            log_denial=True,
        )

        assert result.allowed is False
        assert result.code == "transition_not_configured"
        assert ProjectStateTransitionAuditLog.objects.filter(
            project=project,
            issue=issue,
            action="TRANSITION_DENIED",
        ).exists()

    def test_global_and_exact_rules_are_both_checked_and_deny_wins(
        self,
        create_user,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Combined",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="ANY",
            target_state=project_states[1],
            allow_conditions={
                "kind": "condition",
                "field": "actor.role",
                "operator": "EQ",
                "value": 20,
            },
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            deny_conditions={
                "kind": "condition",
                "field": "priority",
                "operator": "EQ",
                "value": "urgent",
            },
        )

        result = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
            attrs={"priority": "urgent"},
        )

        assert result.allowed is False
        assert result.code == "transition_forbidden"
        assert len(result.applied_rule_ids) == 2

    def test_validation_uses_final_proposed_values_and_returns_field_message(
        self,
        create_user,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Final values",
            description_html="",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            validation_conditions={
                "kind": "group",
                "operator": "AND",
                "children": [
                    {
                        "kind": "condition",
                        "field": "description",
                        "operator": "IS_SET",
                        "message": "Describe the result before changing status.",
                    },
                    {
                        "kind": "condition",
                        "field": "target_date",
                        "operator": "IS_SET",
                    },
                ],
            },
        )

        failed = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
            attrs={"description_html": "<p>Ready</p>"},
        )
        passed = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
            attrs={
                "description_html": "<p>Ready</p>",
                "target_date": "2026-08-10",
            },
        )

        assert failed.allowed is False
        assert failed.reasons == ["Due date must be filled in."]
        assert failed.required_fields == ["target_date"]
        assert passed.allowed is True

    def test_actor_conditions_use_final_proposed_assignees_from_public_serializers(
        self,
        create_user,
        project,
        project_states,
    ):
        actor = User.objects.create_user(
            email="workflow-assignee@plane.so",
            username="workflow-assignee",
            password="test-password",
        )
        ProjectMember.objects.create(
            workspace=project.workspace,
            project=project,
            member=actor,
            role=15,
            is_active=True,
        )
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Assign and transition",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            allow_conditions={
                "kind": "condition",
                "field": "actor.is_assignee",
                "operator": "EQ",
                "value": True,
            },
        )

        failed = evaluate_state_transition(
            project=project,
            actor=actor,
            issue=issue,
            target_state=project_states[1],
        )
        passed = evaluate_state_transition(
            project=project,
            actor=actor,
            issue=issue,
            target_state=project_states[1],
            attrs={"assignees": [actor]},
        )

        assert failed.allowed is False
        assert passed.allowed is True

    def test_project_admin_and_system_bypass_are_independent(
        self,
        create_user,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Bypass",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            allow_conditions={
                "kind": "condition",
                "field": "actor.user",
                "operator": "EQ",
                "value": "00000000-0000-0000-0000-000000000000",
            },
            project_admin_bypass=True,
            system_bypass=False,
        )

        admin_result = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
        )
        system_result = evaluate_state_transition(
            project=project,
            actor=create_user,
            issue=issue,
            target_state=project_states[1],
            is_system=True,
        )

        assert admin_result.allowed is True
        assert system_result.allowed is True

    def test_creation_rules_are_separate_from_normal_transitions(
        self,
        create_user,
        project,
        project_states,
    ):
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="CREATE",
            target_state=project_states[2],
            validation_conditions={
                "kind": "condition",
                "field": "description",
                "operator": "IS_SET",
            },
        )

        failed = evaluate_state_transition(
            project=project,
            actor=create_user,
            target_state=project_states[2],
            attrs={"name": "Created directly in Done"},
            is_creation=True,
        )
        passed = evaluate_state_transition(
            project=project,
            actor=create_user,
            target_state=project_states[2],
            attrs={
                "name": "Created directly in Done",
                "description_html": "<p>Complete</p>",
            },
            is_creation=True,
        )

        assert failed.allowed is False
        assert passed.allowed is True


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectStateTransitionEnforcement:
    def test_creation_rule_is_enforced_before_issue_is_written(
        self,
        session_client,
        workspace,
        project,
        project_states,
    ):
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="CREATE",
            target_state=project_states[1],
            validation_conditions={
                "kind": "condition",
                "field": "description",
                "operator": "IS_SET",
                "message": "Description is required for this initial status.",
            },
        )
        payload = {
            "name": "Created in Doing",
            "state_id": str(project_states[1].id),
            "property_values": {},
        }

        failed = session_client.post(
            _issue_url(workspace, project),
            payload,
            format="json",
        )
        passed = session_client.post(
            _issue_url(workspace, project),
            {
                **payload,
                "description_html": "<p>Implementation has started.</p>",
            },
            format="json",
        )

        assert failed.status_code == status.HTTP_400_BAD_REQUEST
        assert failed.data["state_transition"]["code"] == "validation_failed"
        assert Issue.objects.filter(name="Created in Doing").count() == 1
        assert passed.status_code == status.HTTP_201_CREATED

    def test_state_and_field_update_is_checked_atomically(
        self,
        session_client,
        create_user,
        workspace,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Atomic transition",
            description_html="",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            validation_conditions={
                "kind": "condition",
                "field": "description",
                "operator": "IS_SET",
            },
        )

        failed = session_client.patch(
            _issue_url(workspace, project, issue.id),
            {"state_id": str(project_states[1].id)},
            format="json",
        )
        issue.refresh_from_db()
        assert failed.status_code == status.HTTP_400_BAD_REQUEST
        assert issue.state_id == project_states[0].id
        assert issue.description_html == ""

        passed = session_client.patch(
            _issue_url(workspace, project, issue.id),
            {
                "state_id": str(project_states[1].id),
                "description_html": "<p>Ready for the next step.</p>",
            },
            format="json",
        )
        issue.refresh_from_db()
        assert passed.status_code == status.HTTP_204_NO_CONTENT
        assert issue.state_id == project_states[1].id
        assert "Ready for the next step" in issue.description_html

    def test_external_api_cannot_bypass_transition_rules(
        self,
        api_key_client,
        create_user,
        workspace,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="External API transition",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            validation_conditions={
                "kind": "condition",
                "field": "target_date",
                "operator": "IS_SET",
            },
        )

        response = api_key_client.patch(
            _external_issue_url(workspace, project, issue.id),
            {"state": str(project_states[1].id)},
            format="json",
        )

        issue.refresh_from_db()
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["state_transition"]["code"] == "validation_failed"
        assert issue.state_id == project_states[0].id

    def test_available_and_admin_preview_use_same_engine(
        self,
        session_client,
        create_user,
        workspace,
        project,
        project_states,
    ):
        issue = Issue.objects.create(
            project=project,
            state=project_states[0],
            name="Previewed transition",
            created_by=create_user,
        )
        ProjectStateTransitionSettings.objects.create(project=project, strict_mode=True)
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="EXACT",
            source_state=project_states[0],
            target_state=project_states[1],
            validation_conditions={
                "kind": "condition",
                "field": "target_date",
                "operator": "IS_SET",
            },
        )

        preview = session_client.post(
            _preview_url(workspace, project),
            {
                "actor_id": str(create_user.id),
                "issue_id": str(issue.id),
                "target_state_id": str(project_states[1].id),
            },
            format="json",
        )
        available = session_client.post(
            _available_url(workspace, project),
            {"issue_id": str(issue.id)},
            format="json",
        )

        assert preview.status_code == status.HTTP_200_OK
        assert preview.data["allowed"] is False
        doing_result = next(result for result in available.data if result["state_id"] == str(project_states[1].id))
        assert doing_result["code"] == preview.data["code"]
        assert doing_result["required_fields"] == ["target_date"]

    def test_draft_remains_editable_but_conversion_checks_creation_rule(
        self,
        session_client,
        create_user,
        workspace,
        project,
        project_states,
    ):
        draft = DraftIssue.objects.create(
            workspace=workspace,
            project=project,
            state=project_states[1],
            name="Draft conversion",
            created_by=create_user,
        )
        ProjectStateTransitionRule.objects.create(
            project=project,
            source_type="CREATE",
            target_state=project_states[1],
            validation_conditions={
                "kind": "condition",
                "field": "description",
                "operator": "IS_SET",
            },
        )

        failed = session_client.post(
            _draft_conversion_url(workspace, draft),
            {
                "name": draft.name,
                "state_id": str(project_states[1].id),
                "property_values": {},
            },
            format="json",
        )
        assert failed.status_code == status.HTTP_400_BAD_REQUEST
        assert DraftIssue.objects.filter(id=draft.id).exists()
        assert Issue.objects.filter(name=draft.name).exists() is False

        passed = session_client.post(
            _draft_conversion_url(workspace, draft),
            {
                "name": draft.name,
                "state_id": str(project_states[1].id),
                "description_html": "<p>Ready to leave the draft.</p>",
                "property_values": {},
            },
            format="json",
        )
        assert passed.status_code == status.HTTP_201_CREATED
        assert Issue.objects.filter(name=draft.name, state=project_states[1]).exists()
