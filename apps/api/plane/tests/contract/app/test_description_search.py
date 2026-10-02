# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueVisibility,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.utils.issue_search import search_issues


@pytest.fixture
def description_search(workspace, create_user):
    user = User.objects.create_user(
        email=f"description-search-{uuid.uuid4().hex}@example.com",
        username=f"description-search-{uuid.uuid4().hex}",
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    client = APIClient()
    client.force_authenticate(user)

    def make_project(*, target_workspace=workspace, member=True, **kwargs):
        project = Project.objects.create(
            workspace=target_workspace,
            name=f"Search project {uuid.uuid4().hex[:8]}",
            identifier=f"DS{uuid.uuid4().hex[:6].upper()}",
            **kwargs,
        )
        State.objects.create(
            workspace=target_workspace,
            project=project,
            name="Open",
            color="#3366ff",
            group="started",
            default=True,
        )
        if member:
            ProjectMember.objects.create(
                workspace=target_workspace, project=project, member=user, role=15, is_active=True
            )
        return project

    project = make_project()

    def make_issue(*, target_project=project, name="Unrelated title", description="", **kwargs):
        return Issue.objects.create(
            workspace=target_project.workspace,
            project=target_project,
            name=name,
            description_html=description,
            created_by=create_user,
            **kwargs,
        )

    def search(**params):
        response = client.get(
            f"/api/workspaces/{workspace.slug}/search/",
            {"search": "atlanta", "entities": "issue", **params},
        )
        assert response.status_code == 200, response.data
        return [str(item["id"]) for item in response.data["results"]["issue"]]

    return SimpleNamespace(
        project=project,
        make_project=make_project,
        make_issue=make_issue,
        search=search,
        user=user,
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestDescriptionSearch:
    @pytest.mark.parametrize("flag", [None, "false", "invalid"])
    def test_description_search_is_opt_in(self, description_search, flag):
        context = description_search
        title_match = context.make_issue(name="ATLANTA integration")
        context.make_issue(description="<p>Route to <strong>ATLANTA</strong></p>")

        params = {} if flag is None else {"search_description": flag}
        assert context.search(**params) == [str(title_match.id)]

    @pytest.mark.parametrize("query", ["atlanta", "АтЛаНтА"])
    def test_enabled_search_includes_plain_description_text(self, description_search, query):
        context = description_search
        title_match = context.make_issue(name=f"{query} integration")
        description_match = context.make_issue(description=f"<p>Route to <strong>{query.upper()}</strong></p>")
        both_match = context.make_issue(name=query, description=f"<p>{query}</p>")

        ids = context.search(search=query, search_description="true")
        assert set(ids) == {str(title_match.id), str(description_match.id), str(both_match.id)}
        assert len(ids) == 3

    def test_html_attributes_are_not_description_content(self, description_search):
        context = description_search
        context.make_issue(description='<p data-note="atlanta">Unrelated content</p>')
        context.make_issue(description="")
        assert context.search(search_description="true") == []

    def test_description_toggle_preserves_project_and_workspace_scope(self, description_search):
        context = description_search
        current_issue = context.make_issue(description="<p>ATLANTA</p>")
        other_project = context.make_project()
        other_issue = context.make_issue(target_project=other_project, description="<p>ATLANTA</p>")

        assert context.search(
            search_description="true", workspace_search="false", project_id=str(context.project.id)
        ) == [str(current_issue.id)]
        assert set(
            context.search(search_description="true", workspace_search="true", project_id=str(context.project.id))
        ) == {str(current_issue.id), str(other_issue.id)}

    def test_description_search_preserves_access_and_active_project_filters(
        self, description_search, workspace, create_user
    ):
        context = description_search
        public_issue = context.make_issue(description="<p>ATLANTA</p>")
        context.make_issue(description="<p>ATLANTA</p>", visibility=IssueVisibility.RESTRICTED)
        assigned_issue = context.make_issue(description="<p>ATLANTA</p>", visibility=IssueVisibility.RESTRICTED)
        IssueAssignee.objects.create(
            workspace=workspace, project=context.project, issue=assigned_issue, assignee=context.user
        )
        context.make_issue(description="<p>ATLANTA</p>", deleted_at=timezone.now())
        for project in (
            context.make_project(member=False),
            context.make_project(archived_at=timezone.now()),
            context.make_project(
                target_workspace=Workspace.objects.create(
                    owner=create_user, name="Other workspace", slug=f"other-{uuid.uuid4().hex}"
                )
            ),
        ):
            context.make_issue(target_project=project, description="<p>ATLANTA</p>")

        assert set(context.search(search_description="true", workspace_search="true")) == {
            str(public_issue.id),
            str(assigned_issue.id),
        }

    def test_shared_search_helper_keeps_other_callers_title_only_by_default(self, description_search):
        context = description_search
        title_match = context.make_issue(name="ATLANTA integration")
        description_match = context.make_issue(description="<p>ATLANTA</p>")
        issues = Issue.unscoped_objects.filter(project=context.project)

        assert list(search_issues("atlanta", issues).values_list("id", flat=True)) == [title_match.id]
        assert set(search_issues("atlanta", issues, include_description=True).values_list("id", flat=True)) == {
            title_match.id,
            description_match.id,
        }
