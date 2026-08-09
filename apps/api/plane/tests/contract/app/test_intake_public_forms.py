"""Contract tests for project public Intake forms."""

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    IntakeForm,
    IntakeFormSubmission,
    Project,
    ProjectMember,
    ProjectUserGroup,
    ProjectUserGroupMember,
    State,
    User,
    WorkspaceMember,
)


def _form_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/intake-forms/"


def _intake_url(workspace, project, issue_id=None):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/intake-issues/"
    return f"{base}{issue_id}/" if issue_id else base


@pytest.fixture
def intake_project(workspace, create_user):
    project = Project.objects.create(name="Public support", identifier="SUP", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    target_state = State.objects.create(
        project=project,
        name="To do",
        group="unstarted",
        default=True,
    )
    group = ProjectUserGroup.objects.create(
        workspace=workspace,
        project=project,
        name="Support reviewers",
    )
    ProjectUserGroupMember.objects.create(
        workspace=workspace,
        project=project,
        group=group,
        member=create_user,
    )
    return project, target_state, group


def _form_payload(target_state, group, **overrides):
    payload = {
        "name": "Техническая поддержка",
        "slug": "Техническая поддержка",
        "description": "Tell us what happened.",
        "access_type": "PUBLIC",
        "target_state": str(target_state.id),
        "reviewer_group": str(group.id),
        "title_template": "",
        "email_notifications_enabled": False,
        "max_attachments": 20,
        "field_schema": [
            {
                "id": "requester_name",
                "source": "FORM",
                "key": "requester_name",
                "visible": True,
                "required": False,
            },
            {
                "id": "requester_email",
                "source": "FORM",
                "key": "requester_email",
                "visible": True,
                "required": False,
            },
            {
                "id": "title",
                "source": "SYSTEM",
                "key": "title",
                "visible": True,
                "required": True,
            },
            {
                "id": "description",
                "source": "SYSTEM",
                "key": "description",
                "visible": True,
                "required": False,
            },
        ],
        "conditions": [],
    }
    payload.update(overrides)
    return payload


@pytest.mark.contract
@pytest.mark.django_db
class TestIntakePublicForms:
    def test_project_admin_creates_form_with_transliterated_globally_unique_slug(
        self,
        session_client,
        workspace,
        intake_project,
        create_user,
    ):
        project, target_state, group = intake_project
        created = session_client.post(
            _form_url(workspace, project),
            _form_payload(target_state, group),
            format="json",
        )

        assert created.status_code == status.HTTP_201_CREATED, created.data
        assert created.data["slug"] == "tehnicheskaya-podderzhka"
        assert created.data["public_path"] == "/support/tehnicheskaya-podderzhka"
        assert project.__class__.objects.get(id=project.id).intake_view is True

        second_project = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
        ProjectMember.objects.create(project=second_project, member=create_user, role=20)
        second_state = State.objects.create(project=second_project, name="Todo", group="unstarted", default=True)
        second_group = ProjectUserGroup.objects.create(
            workspace=workspace,
            project=second_project,
            name="Reviewers",
        )
        duplicate = session_client.post(
            _form_url(workspace, second_project),
            _form_payload(second_state, second_group, slug="tehnicheskaya-podderzhka"),
            format="json",
        )
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
        assert duplicate.data["slug"]["suggestions"]

    def test_blank_title_template_is_only_rejected_when_title_is_hidden(
        self,
        session_client,
        workspace,
        intake_project,
    ):
        project, target_state, group = intake_project
        visible_title = session_client.post(
            _form_url(workspace, project),
            _form_payload(target_state, group, slug="visible-title"),
            format="json",
        )

        assert visible_title.status_code == status.HTTP_201_CREATED, visible_title.data
        assert visible_title.data["title_template"] == ""

        hidden_title_payload = _form_payload(target_state, group, slug="hidden-title")
        hidden_title_payload["field_schema"][2]["visible"] = False
        hidden_title_payload["field_schema"][2]["required"] = False
        hidden_title = session_client.post(
            _form_url(workspace, project),
            hidden_title_payload,
            format="json",
        )

        assert hidden_title.status_code == status.HTTP_400_BAD_REQUEST
        assert "title_template" in hidden_title.data

    def test_code_and_workspace_access_modes(self, session_client, api_client, workspace, intake_project):
        project, target_state, group = intake_project
        public_client = APIClient()
        code_form = session_client.post(
            _form_url(workspace, project),
            _form_payload(
                target_state,
                group,
                name="Private support",
                slug="private-support",
                access_type="CODE",
                access_code="GTS-123456",
            ),
            format="json",
        )
        assert code_form.status_code == 201
        public_url = "/api/public/support/forms/private-support/"
        assert public_client.get(public_url).status_code == 403
        public_client.credentials(HTTP_X_INTAKE_CODE="GTS-123456")
        opened = public_client.get(public_url)
        assert opened.status_code == 200
        assert len(opened.data["tracking_token"]) >= 32
        assert opened.headers["Cache-Control"] == "no-store"

        authenticated = session_client.post(
            _form_url(workspace, project),
            _form_payload(
                target_state,
                group,
                name="Workspace support",
                slug="workspace-support",
                access_type="AUTHENTICATED",
            ),
            format="json",
        )
        assert authenticated.status_code == 201
        public_client.credentials()
        assert public_client.get("/api/public/support/forms/workspace-support/").status_code == 401
        assert session_client.get("/api/public/support/forms/workspace-support/").status_code == 200

    @patch("plane.space.views.intake_form.send_intake_form_requester_email.delay")
    def test_public_submission_creates_triage_item_and_tracking_page(
        self,
        mock_email,
        session_client,
        api_client,
        workspace,
        intake_project,
    ):
        project, target_state, group = intake_project
        response = session_client.post(
            _form_url(workspace, project),
            _form_payload(target_state, group, slug="helpdesk"),
            format="json",
        )
        assert response.status_code == 201

        token = "t" * 48
        created = api_client.post(
            "/api/public/support/forms/helpdesk/",
            {
                "tracking_token": token,
                "locale": "ru",
                "values": {
                    "requester_name": "Customer",
                    "requester_email": "customer@example.com",
                    "title": "Cannot book",
                    "description": "The booking button does not work.",
                },
                "asset_ids": [],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="public-request-1",
        )
        assert created.status_code == 201, created.data
        submission = IntakeFormSubmission.objects.get(reference=created.data["reference"])
        assert submission.intake_issue.status == -2
        assert submission.intake_issue.source == "FORMS"
        assert submission.intake_issue.issue.state.group == "triage"
        assert submission.intake_issue.issue.name == "Cannot book"
        assert mock_email.called

        tracking = api_client.get(f"/api/public/support/status/{token}/")
        assert tracking.status_code == 200
        assert tracking.data["reference"] == submission.reference
        assert tracking.data["public_status"] == "RECEIVED"

    @patch("plane.space.views.intake_form.send_intake_form_requester_email.delay")
    def test_conditionally_hidden_required_field_is_not_validated(
        self,
        mock_email,
        session_client,
        api_client,
        workspace,
        intake_project,
    ):
        project, target_state, group = intake_project
        payload = _form_payload(target_state, group, slug="conditional")
        payload["field_schema"][3].update({"visible": False, "required": True})
        payload["conditions"] = [
            {
                "target_field_id": "description",
                "action": "SHOW",
                "match": "ALL",
                "rules": [{"field_id": "title", "operator": "EQUALS", "value": "show"}],
            }
        ]
        assert session_client.post(_form_url(workspace, project), payload, format="json").status_code == 201

        response = api_client.post(
            "/api/public/support/forms/conditional/",
            {
                "tracking_token": "c" * 48,
                "values": {"title": "hidden description"},
                "asset_ids": [],
            },
            format="json",
        )
        assert response.status_code == 201, response.data

    @patch("plane.app.serializers.intake.send_intake_form_requester_email.delay")
    @patch("plane.space.views.intake_form.send_intake_form_requester_email.delay")
    def test_assigned_group_can_review_and_accept_into_configured_state(
        self,
        mock_submission_email,
        mock_status_email,
        session_client,
        api_client,
        workspace,
        intake_project,
    ):
        project, target_state, group = intake_project
        reviewer = User.objects.create_user(
            email=f"reviewer-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
        )
        outsider = User.objects.create_user(
            email=f"outsider-{uuid.uuid4().hex}@plane.so",
            username=uuid.uuid4().hex,
        )
        for user in (reviewer, outsider):
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
            ProjectMember.objects.create(project=project, member=user, role=15)
        ProjectUserGroupMember.objects.create(
            workspace=workspace,
            project=project,
            group=group,
            member=reviewer,
        )
        assert session_client.post(
            _form_url(workspace, project),
            _form_payload(target_state, group, slug="reviewed"),
            format="json",
        ).status_code == 201
        created = api_client.post(
            "/api/public/support/forms/reviewed/",
            {"tracking_token": "r" * 48, "values": {"title": "Review me"}, "asset_ids": []},
            format="json",
        )
        submission = IntakeFormSubmission.objects.get(reference=created.data["reference"])
        issue = submission.intake_issue.issue

        outsider_client = APIClient()
        outsider_client.force_authenticate(outsider)
        reviewer_client = APIClient()
        reviewer_client.force_authenticate(reviewer)
        assert outsider_client.get(_intake_url(workspace, project, issue.id)).status_code == 403
        assert reviewer_client.get(_intake_url(workspace, project, issue.id)).status_code == 200

        accepted = reviewer_client.patch(
            _intake_url(workspace, project, issue.id),
            {"status": 1},
            format="json",
        )
        assert accepted.status_code == 200, accepted.data
        issue.refresh_from_db()
        submission.refresh_from_db()
        assert issue.state_id == target_state.id
        assert submission.public_status == "IN_PROGRESS"

    @patch("plane.space.views.intake_form.send_intake_form_requester_email.delay")
    def test_form_with_submissions_cannot_be_deleted(
        self,
        mock_email,
        session_client,
        api_client,
        workspace,
        intake_project,
    ):
        project, target_state, group = intake_project
        created = session_client.post(
            _form_url(workspace, project),
            _form_payload(target_state, group, slug="delete-policy"),
            format="json",
        )
        form = IntakeForm.objects.get(id=created.data["id"])
        submitted = api_client.post(
            "/api/public/support/forms/delete-policy/",
            {"tracking_token": "d" * 48, "values": {"title": "Keep me"}, "asset_ids": []},
            format="json",
        )
        assert submitted.status_code == 201, submitted.data
        assert session_client.delete(f"{_form_url(workspace, project)}{form.id}/").status_code == 400
        assert session_client.post(f"{_form_url(workspace, project)}{form.id}/archive/").status_code == 200
