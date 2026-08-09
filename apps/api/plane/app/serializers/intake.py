# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import transaction

# Third party frameworks
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .issue import IssueCreateSerializer, IssueIntakeSerializer, LabelLiteSerializer, IssueDetailSerializer
from .project import ProjectLiteSerializer
from .state import StateLiteSerializer
from .user import UserLiteSerializer
from plane.db.models import Intake, IntakeIssue, Issue, State, StateGroup
from plane.bgtasks.intake_form_task import send_intake_form_requester_email


class IntakeSerializer(BaseSerializer):
    project_detail = ProjectLiteSerializer(source="project", read_only=True)
    pending_issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Intake
        fields = "__all__"
        read_only_fields = ["project", "workspace"]


class IntakeIssueSerializer(BaseSerializer):
    issue = IssueIntakeSerializer(read_only=True)
    target_state_id = serializers.UUIDField(write_only=True, required=False)
    form_submission = serializers.SerializerMethodField()

    class Meta:
        model = IntakeIssue
        fields = [
            "id",
            "status",
            "duplicate_to",
            "snoozed_till",
            "source",
            "source_email",
            "issue",
            "created_by",
            "target_state_id",
            "form_submission",
        ]
        read_only_fields = ["project", "workspace"]

    def get_form_submission(self, obj):
        submission = getattr(obj, "form_submission", None)
        if not submission:
            return None
        return {
            "id": str(submission.id),
            "reference": submission.reference,
            "requester_name": submission.requester_name,
            "requester_email": submission.requester_email,
            "form_id": str(submission.form_id),
            "form_name": submission.form.name,
            "public_status": submission.public_status,
        }

    def validate(self, attrs):
        """
        Validate that if status is being changed to accepted (1),
        the project has a default state to transition to.
        """

        # Check if status is being updated to accepted
        if attrs.get("status") == 1:
            intake_issue = self.instance
            issue = intake_issue.issue

            # Check if issue is in TRIAGE state
            if issue.state and issue.state.group == StateGroup.TRIAGE.value:
                # Verify default state exists before allowing the update
                submission = getattr(intake_issue, "form_submission", None)
                default_state = (
                    submission.form.target_state
                    if submission
                    else State.objects.filter(
                        workspace=intake_issue.workspace,
                        project=intake_issue.project,
                        default=True,
                    ).first()
                )

                if not default_state:
                    raise serializers.ValidationError(
                        {"status": "Cannot accept intake issue: No default state found for the project"}
                    )

        return attrs

    @transaction.atomic
    def update(self, instance, validated_data):
        target_state_id = validated_data.pop("target_state_id", None)
        submission = getattr(instance, "form_submission", None)
        if validated_data.get("status") == 1 and submission:
            target_state = State.objects.filter(
                project=instance.project,
                id=target_state_id or submission.form.target_state_id,
                is_triage=False,
            ).first()
            if not target_state:
                raise serializers.ValidationError({"target_state_id": "Select a valid target state."})
            issue_data = dict(self.context.get("issue_updates") or {})
            issue_data["state_id"] = str(target_state.id)
            issue_serializer = IssueCreateSerializer(
                instance.issue,
                data=issue_data,
                partial=True,
                context={
                    "project_id": str(instance.project_id),
                    "workspace_id": str(instance.workspace_id),
                    "default_assignee_id": instance.project.default_assignee_id,
                    "request": self.context.get("request"),
                },
            )
            issue_serializer.is_valid(raise_exception=True)
            issue_serializer.save()

        # Update the intake issue
        instance = super().update(instance, validated_data)

        # If status is accepted (1), transition the issue state from TRIAGE to default
        if validated_data.get("status") == 1 and not submission:
            issue = instance.issue
            if issue.state and issue.state.group == StateGroup.TRIAGE.value:
                # Get the default project state
                default_state = State.objects.filter(
                    workspace=instance.workspace, project=instance.project, default=True
                ).first()
                if default_state:
                    issue.state = default_state
                    issue.save()

        if submission and "status" in validated_data:
            from plane.space.serializer.intake_form import sync_public_submission_status

            previous_status = submission.public_status
            public_status = sync_public_submission_status(submission)
            if public_status != previous_status:
                send_intake_form_requester_email.delay(str(submission.id), "STATUS_CHANGED")

        return instance

    def to_representation(self, instance):
        # Pass the annotated fields to the Issue instance if they exist
        if hasattr(instance, "label_ids"):
            instance.issue.label_ids = instance.label_ids
        return super().to_representation(instance)


class IntakeIssueDetailSerializer(BaseSerializer):
    issue = IssueDetailSerializer(read_only=True)
    duplicate_issue_detail = IssueIntakeSerializer(read_only=True, source="duplicate_to")
    form_submission = serializers.SerializerMethodField()

    class Meta:
        model = IntakeIssue
        fields = [
            "id",
            "status",
            "duplicate_to",
            "snoozed_till",
            "duplicate_issue_detail",
            "source",
            "source_email",
            "issue",
            "form_submission",
        ]
        read_only_fields = ["project", "workspace"]

    def get_form_submission(self, obj):
        return IntakeIssueSerializer(context=self.context).get_form_submission(obj)

    def to_representation(self, instance):
        # Pass the annotated fields to the Issue instance if they exist
        if hasattr(instance, "assignee_ids"):
            instance.issue.assignee_ids = instance.assignee_ids
        if hasattr(instance, "label_ids"):
            instance.issue.label_ids = instance.label_ids

        return super().to_representation(instance)


class IntakeIssueLiteSerializer(BaseSerializer):
    class Meta:
        model = IntakeIssue
        fields = ["id", "status", "duplicate_to", "snoozed_till", "source"]
        read_only_fields = fields


class IssueStateIntakeSerializer(BaseSerializer):
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    issue_intake = IntakeIssueLiteSerializer(read_only=True, many=True)

    class Meta:
        model = Issue
        fields = "__all__"
