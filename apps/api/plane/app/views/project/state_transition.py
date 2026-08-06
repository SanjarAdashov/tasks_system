# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response

from plane.app.permissions import ProjectAdminPermission, ProjectLitePermission
from plane.app.serializers import (
    ProjectStateTransitionAuditLogSerializer,
    ProjectStateTransitionRuleSerializer,
    ProjectStateTransitionSettingsSerializer,
)
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    Issue,
    Project,
    ProjectStateTransitionAuditLog,
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectMember,
    State,
    StateTransitionAuditAction,
    User,
)
from plane.utils.state_transition_rules import evaluate_state_transition


class ProjectStateTransitionPermissionMixin:
    def get_permissions(self):
        permission_classes = (
            [ProjectLitePermission] if self.request.method in SAFE_METHODS else [ProjectAdminPermission]
        )
        return [permission() for permission in permission_classes]


class ProjectStateTransitionSettingsEndpoint(
    ProjectStateTransitionPermissionMixin,
    BaseAPIView,
):
    def get_project(self, slug, project_id):
        return get_object_or_404(
            Project,
            id=project_id,
            workspace__slug=slug,
        )

    def get_settings(self, project):
        settings, _ = ProjectStateTransitionSettings.objects.get_or_create(project=project)
        return settings

    def get(self, request, slug, project_id):
        settings = self.get_settings(self.get_project(slug, project_id))
        return Response(
            ProjectStateTransitionSettingsSerializer(settings).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request, slug, project_id):
        settings = self.get_settings(self.get_project(slug, project_id))
        serializer = ProjectStateTransitionSettingsSerializer(
            settings,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProjectStateTransitionRuleViewSet(
    ProjectStateTransitionPermissionMixin,
    BaseViewSet,
):
    serializer_class = ProjectStateTransitionRuleSerializer
    model = ProjectStateTransitionRule

    def get_project(self):
        return get_object_or_404(
            Project,
            id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )

    def get_queryset(self):
        queryset = ProjectStateTransitionRule.objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).select_related("source_state", "target_state")
        if self.request.query_params.get("include_archived") != "true":
            queryset = queryset.filter(archived_at__isnull=True)
        return queryset.order_by("created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = self.get_project()
        return context

    def create(self, request, slug, project_id):
        project = self.get_project()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(project=project)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, slug, project_id, pk):
        rule = self.get_object()
        before = ProjectStateTransitionRuleSerializer._snapshot(rule)
        rule.archived_at = timezone.now()
        rule.save(update_fields=["archived_at", "updated_at"])
        ProjectStateTransitionAuditLog.objects.create(
            project=rule.project,
            action=StateTransitionAuditAction.CONFIGURATION_CHANGED,
            rule=rule,
            source_state=rule.source_state,
            target_state=rule.target_state,
            created_by=request.user,
            details={
                "operation": "rule_archived",
                "before": before,
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectStateTransitionAuditLogViewSet(BaseViewSet):
    serializer_class = ProjectStateTransitionAuditLogSerializer
    model = ProjectStateTransitionAuditLog
    permission_classes = [ProjectAdminPermission]
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        queryset = ProjectStateTransitionAuditLog.objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).select_related(
            "created_by",
            "issue",
            "rule",
            "source_state",
            "target_state",
        )
        action = self.request.query_params.get("action")
        if action:
            queryset = queryset.filter(action=action)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(details__icontains=search)
                | Q(issue__name__icontains=search)
                | Q(created_by__display_name__icontains=search)
            )
        return queryset.order_by("-created_at")


class ProjectStateTransitionPreviewEndpoint(BaseAPIView):
    permission_classes = [ProjectAdminPermission]

    def post(self, request, slug, project_id):
        project = get_object_or_404(
            Project,
            id=project_id,
            workspace__slug=slug,
        )
        actor_id = request.data.get("actor_id")
        actor = request.user
        if actor_id:
            actor = get_object_or_404(
                User,
                id=actor_id,
                is_active=True,
                member_project__project=project,
                member_project__is_active=True,
            )
        issue = None
        issue_id = request.data.get("issue_id")
        if issue_id:
            issue = get_object_or_404(Issue, id=issue_id, project=project)
        target_state = get_object_or_404(
            State,
            id=request.data.get("target_state_id"),
            project=project,
            is_triage=False,
        )
        is_creation = bool(request.data.get("is_creation", issue is None))
        result = evaluate_state_transition(
            project=project,
            actor=actor,
            issue=issue,
            target_state=target_state,
            attrs=request.data.get("proposed_data") or {},
            is_creation=is_creation,
        )
        return Response(result.as_dict(), status=status.HTTP_200_OK)


class ProjectAvailableStateTransitionsEndpoint(BaseAPIView):
    permission_classes = [ProjectLitePermission]

    def post(self, request, slug, project_id):
        project = get_object_or_404(
            Project,
            id=project_id,
            workspace__slug=slug,
        )
        if not ProjectMember.objects.filter(
            project=project,
            member=request.user,
            is_active=True,
        ).exists():
            return Response(status=status.HTTP_403_FORBIDDEN)

        issue = None
        issue_id = request.data.get("issue_id")
        if issue_id:
            issue = get_object_or_404(Issue, id=issue_id, project=project)
        is_creation = bool(request.data.get("is_creation", issue is None))
        proposed_data = request.data.get("proposed_data") or {}
        transitions = []
        for state_instance in State.objects.filter(
            project=project,
            is_triage=False,
        ).order_by("sequence"):
            if issue and state_instance.id == issue.state_id:
                continue
            result = evaluate_state_transition(
                project=project,
                actor=request.user,
                issue=issue,
                target_state=state_instance,
                attrs=proposed_data,
                is_creation=is_creation,
            )
            transitions.append(
                {
                    "state_id": str(state_instance.id),
                    **result.as_dict(),
                }
            )
        return Response(transitions, status=status.HTTP_200_OK)
