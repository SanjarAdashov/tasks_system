# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from itertools import groupby
from collections import defaultdict

# Django imports
from django.db import transaction
from django.db.utils import IntegrityError

# Third party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet, BaseAPIView
from plane.app.serializers import StateOrderSerializer, StateSerializer
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import State, Issue
from plane.utils.cache import invalidate_cache


class StateViewSet(BaseViewSet):
    serializer_class = StateSerializer
    model = State

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .filter(is_triage=False)
            .select_related("project")
            .select_related("workspace")
            .distinct()
        )

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        try:
            serializer = StateSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def partial_update(self, request, slug, project_id, pk):
        try:
            state = State.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
            update_data = request.data.copy()
            if "sequence" in update_data:
                try:
                    requested_sequence = float(update_data["sequence"])
                except (TypeError, ValueError):
                    requested_sequence = None

                if requested_sequence != state.sequence:
                    return Response(
                        {"sequence": "Use the project state order endpoint to change state order"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                update_data.pop("sequence")

            serializer = StateSerializer(state, data=update_data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        states = StateSerializer(self.get_queryset(), many=True).data

        grouped_states = defaultdict(list)
        for state in states:
            grouped_states[state["group"]].append(state)

        for group, group_states in grouped_states.items():
            count = len(group_states)

            for index, state in enumerate(group_states, start=1):
                state["order"] = index / count

        grouped = request.GET.get("grouped", False)

        if grouped == "true":
            state_dict = {}
            for key, value in groupby(
                sorted(states, key=lambda state: state["group"]),
                lambda state: state.get("group"),
            ):
                state_dict[str(key)] = list(value)
            return Response(state_dict, status=status.HTTP_200_OK)

        return Response(states, status=status.HTTP_200_OK)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def reorder(self, request, slug, project_id):
        serializer = StateOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested_ids = serializer.validated_data["state_ids"]

        with transaction.atomic():
            states = list(
                State.objects.select_for_update()
                .filter(workspace__slug=slug, project_id=project_id, is_triage=False)
                .order_by("sequence", "created_at", "id")
            )
            states_by_id = {state.id: state for state in states}

            if len(requested_ids) != len(states) or set(requested_ids) != set(states_by_id):
                return Response(
                    {"state_ids": "Provide every active project state exactly once"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            ordered_states = [states_by_id[state_id] for state_id in requested_ids]
            for index, state in enumerate(ordered_states, start=1):
                state.sequence = index * 10000

            State.objects.bulk_update(ordered_states, ["sequence"])

        return Response(StateSerializer(ordered_states, many=True).data, status=status.HTTP_200_OK)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def mark_as_default(self, request, slug, project_id, pk):
        # Select all the states which are marked as default
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, default=True).update(default=False)
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk).update(default=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        state = State.objects.get(is_triage=False, pk=pk, project_id=project_id, workspace__slug=slug)

        if state.default:
            return Response(
                {"error": "Default state cannot be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for any issues in the state
        issue_exist = Issue.objects.filter(state=pk).exists()

        if issue_exist:
            return Response(
                {"error": "The state is not empty, only empty states can be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            state.delete()
            remaining_states = list(
                State.objects.select_for_update()
                .filter(workspace__slug=slug, project_id=project_id, is_triage=False)
                .order_by("sequence", "created_at", "id")
            )
            for index, remaining_state in enumerate(remaining_states, start=1):
                remaining_state.sequence = index * 10000
            State.objects.bulk_update(remaining_states, ["sequence"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class IntakeStateEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        state = State.triage_objects.filter(workspace__slug=slug, project_id=project_id).first()
        if not state:
            return Response(
                {"error": "Triage state not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(StateSerializer(state).data, status=status.HTTP_200_OK)
