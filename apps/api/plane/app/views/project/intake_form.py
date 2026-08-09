# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectAdminPermission
from plane.app.serializers import IntakeFormSerializer
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import Intake, IntakeForm, Project
from plane.utils.intake_forms import generate_access_code, suggest_intake_form_slugs


class IntakeFormViewSet(BaseViewSet):
    serializer_class = IntakeFormSerializer
    model = IntakeForm
    permission_classes = [ProjectAdminPermission]

    def get_queryset(self):
        return (
            IntakeForm.objects.filter(
                workspace__slug=self.workspace_slug,
                project_id=self.project_id,
            )
            .select_related("target_state", "reviewer_group")
            .annotate(submission_count=Count("submissions"))
            .order_by("archived_at", "name")
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["project"] = get_object_or_404(Project, id=self.project_id, workspace__slug=self.workspace_slug)
        return context

    def perform_create(self, serializer):
        project = self.get_serializer_context()["project"]
        intake, _ = Intake.objects.get_or_create(
            project=project,
            defaults={
                "workspace": project.workspace,
                "name": f"{project.name} Intake",
                "description": "",
                "is_default": True,
            },
        )
        if not project.intake_view:
            project.intake_view = True
            project.save(update_fields=["intake_view", "updated_at"])
        serializer.save(project=project, workspace=project.workspace, intake=intake)

    def destroy(self, request, slug, project_id, pk):
        form = get_object_or_404(self.get_queryset(), pk=pk)
        if form.submissions.exists():
            return Response(
                {"error": "Forms with submissions can only be archived."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        form.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def archive(self, request, slug, project_id, pk):
        form = get_object_or_404(self.get_queryset(), pk=pk)
        form.archived_at = timezone.now()
        form.is_enabled = False
        form.save(update_fields=["archived_at", "is_enabled", "updated_at"])
        return Response(self.get_serializer(form).data)

    def restore(self, request, slug, project_id, pk):
        form = get_object_or_404(self.get_queryset(), pk=pk)
        form.archived_at = None
        form.save(update_fields=["archived_at", "updated_at"])
        return Response(self.get_serializer(form).data)


class IntakeFormSlugSuggestionEndpoint(BaseAPIView):
    permission_classes = [ProjectAdminPermission]

    def get(self, request, slug, project_id):
        value = request.query_params.get("value", "")
        return Response({"suggestions": suggest_intake_form_slugs(value)})


class IntakeFormAccessCodeEndpoint(BaseAPIView):
    permission_classes = [ProjectAdminPermission]

    def post(self, request, slug, project_id):
        return Response({"access_code": generate_access_code()})
