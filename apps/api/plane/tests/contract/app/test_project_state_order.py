# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember
from plane.utils.analytics_plot import build_graph_plot


def _states_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/states/"


def _reorder_url(workspace, project):
    return f"{_states_url(workspace, project)}reorder/"


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="Ordered states", identifier="ORDER", workspace=workspace)
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
        State.objects.create(project=project, name="Backlog", color="#111111", group="backlog", sequence=100),
        State.objects.create(project=project, name="Done", color="#222222", group="completed"),
        State.objects.create(project=project, name="Doing", color="#333333", group="started"),
        State.objects.create(project=project, name="Todo", color="#444444", group="unstarted"),
    ]


@pytest.mark.contract
@pytest.mark.django_db
class TestProjectStateOrder:
    def test_project_admin_can_save_one_cross_group_order(self, session_client, workspace, project, project_states):
        requested = [project_states[2], project_states[0], project_states[3], project_states[1]]
        original_groups = {state.id: state.group for state in project_states}

        response = session_client.post(
            _reorder_url(workspace, project),
            {"state_ids": [str(state.id) for state in requested]},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert [str(state["id"]) for state in response.data] == [str(state.id) for state in requested]
        assert [state["sequence"] for state in response.data] == [10000, 20000, 30000, 40000]
        assert {state["id"]: state["group"] for state in response.data} == original_groups

        list_response = session_client.get(_states_url(workspace, project))
        assert [str(state["id"]) for state in list_response.data] == [str(state.id) for state in requested]

    def test_non_admin_cannot_reorder(self, workspace, project, project_states):
        member = User.objects.create_user(
            email="state-member@plane.so",
            username="state-member",
            password="test-password",
        )
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace,
            project=project,
            member=member,
            role=15,
            is_active=True,
        )
        client = APIClient()
        client.force_authenticate(user=member)

        response = client.post(
            _reorder_url(workspace, project),
            {"state_ids": [str(state.id) for state in reversed(project_states)]},
            format="json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.parametrize("payload_kind", ["missing", "duplicate"])
    def test_incomplete_or_duplicate_order_is_rejected_atomically(
        self, payload_kind, session_client, workspace, project, project_states
    ):
        original_order = list(State.objects.filter(project=project).values_list("id", flat=True))
        requested_ids = [str(state.id) for state in project_states]
        if payload_kind == "missing":
            requested_ids.pop()
        else:
            requested_ids[-1] = requested_ids[0]

        response = session_client.post(
            _reorder_url(workspace, project),
            {"state_ids": requested_ids},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert list(State.objects.filter(project=project).values_list("id", flat=True)) == original_order

    def test_direct_sequence_patch_is_rejected(self, session_client, workspace, project, project_states):
        state = project_states[0]
        original_sequence = state.sequence

        response = session_client.patch(
            f"{_states_url(workspace, project)}{state.id}/",
            {"sequence": 1},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        state.refresh_from_db()
        assert state.sequence == original_sequence

    def test_state_rename_accepts_unchanged_sequence_from_legacy_form(
        self, session_client, workspace, project, project_states
    ):
        state = project_states[0]
        original_sequence = state.sequence

        response = session_client.patch(
            f"{_states_url(workspace, project)}{state.id}/",
            {"name": "Renamed backlog", "sequence": original_sequence},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        state.refresh_from_db()
        assert state.name == "Renamed backlog"
        assert state.sequence == original_sequence

    def test_new_and_restored_states_are_appended(self, project, project_states):
        deleted_state = project_states[1]
        deleted_state.delete()
        active_ids = list(State.objects.filter(project=project).values_list("id", flat=True))

        new_state = State.objects.create(project=project, name="New last", color="#555555", group="cancelled")
        assert list(State.objects.filter(project=project).values_list("id", flat=True)) == [*active_ids, new_state.id]

        deleted_state.deleted_at = None
        deleted_state.save()
        assert list(State.objects.filter(project=project).values_list("id", flat=True))[-1] == deleted_state.id

    def test_delete_endpoint_compacts_remaining_sequences(self, session_client, workspace, project, project_states):
        response = session_client.delete(f"{_states_url(workspace, project)}{project_states[1].id}/")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert list(State.objects.filter(project=project).values_list("sequence", flat=True)) == [10000, 20000, 30000]

    def test_state_analytics_uses_saved_project_order(self, session_client, workspace, project, project_states):
        requested = [project_states[2], project_states[0], project_states[3], project_states[1]]
        response = session_client.post(
            _reorder_url(workspace, project),
            {"state_ids": [str(state.id) for state in requested]},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

        for index, state in enumerate(project_states):
            Issue.objects.create(
                workspace=workspace,
                project=project,
                state=state,
                name=f"Analytics item {index}",
            )

        distribution = build_graph_plot(
            queryset=Issue.issue_objects.filter(project=project),
            x_axis="state_id",
            y_axis="issue_count",
        )

        assert list(distribution) == [str(state.id) for state in requested]
