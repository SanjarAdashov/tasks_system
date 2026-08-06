# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.utils import timezone
from django.db import transaction

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .state import StateSerializer, StateLiteSerializer
from .project import ProjectLiteSerializer
from .cycle import CycleBaseSerializer
from .module import ModuleBaseSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueComment,
    ProjectMember,
    IssueAssignee,
    IssueLabel,
    Label,
    CycleIssue,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
)
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)
from plane.utils.work_item_fields import (
    MISSING,
    persist_work_item_property_values,
    serialize_work_item_property_values,
    sync_issue_cycle_and_modules,
    validate_and_prepare_work_item_fields,
)


class IssueStateFlatSerializer(BaseSerializer):
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


class LabelSerializer(BaseSerializer):
    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Label
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueProjectLiteSerializer(BaseSerializer):
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


class IssueRelationSerializer(BaseSerializer):
    issue_detail = IssueProjectLiteSerializer(read_only=True, source="related_issue")

    class Meta:
        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class RelatedIssueSerializer(BaseSerializer):
    issue_detail = IssueProjectLiteSerializer(read_only=True, source="issue")

    class Meta:
        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class IssueCycleDetailSerializer(BaseSerializer):
    cycle_detail = CycleBaseSerializer(read_only=True, source="cycle")

    class Meta:
        model = CycleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueModuleDetailSerializer(BaseSerializer):
    module_detail = ModuleBaseSerializer(read_only=True, source="module")

    class Meta:
        model = ModuleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueLinkSerializer(BaseSerializer):
    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")

    class Meta:
        model = IssueLink
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "issue",
        ]

    # Validation if url already exists
    def create(self, validated_data):
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)


class IssueAttachmentSerializer(BaseSerializer):
    class Meta:
        model = FileAsset
        fields = "__all__"
        read_only_fields = [
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "workspace",
            "project",
            "issue",
        ]


class IssueReactionSerializer(BaseSerializer):
    class Meta:
        model = IssueReaction
        fields = ["issue", "reaction", "workspace", "project", "actor"]
        read_only_fields = ["workspace", "project", "issue", "actor"]


class IssueSerializer(BaseSerializer):
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateSerializer(read_only=True, source="state")
    parent_detail = IssueStateFlatSerializer(read_only=True, source="parent")
    label_details = LabelSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    related_issues = IssueRelationSerializer(read_only=True, source="issue_relation", many=True)
    issue_relations = RelatedIssueSerializer(read_only=True, source="issue_related", many=True)
    issue_cycle = IssueCycleDetailSerializer(read_only=True)
    issue_module = IssueModuleDetailSerializer(read_only=True)
    issue_link = IssueLinkSerializer(read_only=True, many=True)
    issue_attachment = IssueAttachmentSerializer(read_only=True, many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    issue_reactions = IssueReactionSerializer(read_only=True, many=True)

    class Meta:
        model = Issue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueFlatSerializer(BaseSerializer):
    ## Contain only flat fields

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "description_json",
            "description_html",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "sort_order",
            "is_draft",
        ]


class CommentReactionLiteSerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = CommentReaction
        fields = ["id", "reaction", "comment", "actor_detail"]


class IssueCommentSerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionLiteSerializer(read_only=True, many=True)
    is_member = serializers.BooleanField(read_only=True)

    class Meta:
        model = IssueComment
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "issue",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    state_detail = StateSerializer(read_only=True, source="state")
    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")

    assignees = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    labels = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )

    cycle_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    module_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        allow_null=True,
        required=False,
    )
    property_values = serializers.JSONField(required=False, write_only=True)

    class Meta:
        model = Issue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["assignees"] = [str(assignee.id) for assignee in instance.assignees.all()]
        data["labels"] = [str(label.id) for label in instance.labels.all()]
        data["cycle_id"] = CycleIssue.objects.filter(issue=instance).values_list("cycle_id", flat=True).first()
        data["module_ids"] = list(ModuleIssue.objects.filter(issue=instance).values_list("module_id", flat=True))
        data["property_values"] = serialize_work_item_property_values(instance)
        return data

    def validate(self, data):
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if "description_binary" in data and data["description_binary"]:
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        if data.get("assignees", []):
            active_assignee_ids = set(
                ProjectMember.objects.filter(
                    project_id=self.context["project_id"],
                    is_active=True,
                    member__is_active=True,
                    member_id__in=data["assignees"],
                ).values_list("member_id", flat=True)
            )
            data["assignees"] = [assignee for assignee in data["assignees"] if assignee.id in active_assignee_ids]

        property_values = data.pop("property_values", MISSING)
        data["property_values"] = validate_and_prepare_work_item_fields(
            project_id=self.context["project_id"],
            attrs=data,
            instance=self.instance,
            property_values=property_values,
        )
        return data

    @transaction.atomic
    def create(self, validated_data):
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)
        cycle_id = validated_data.pop("cycle_id", MISSING)
        module_ids = validated_data.pop("module_ids", MISSING)
        property_values = validated_data.pop("property_values")

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )
        else:
            # Then assign it to default assignee
            if (
                default_assignee_id is not None
                and ProjectMember.objects.filter(
                    project_id=project_id,
                    member_id=default_assignee_id,
                    is_active=True,
                    member__is_active=True,
                ).exists()
            ):
                IssueAssignee.objects.create(
                    assignee_id=default_assignee_id,
                    issue=issue,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    created_by_id=created_by_id,
                    updated_by_id=updated_by_id,
                )

        if labels is not None and len(labels):
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        sync_issue_cycle_and_modules(
            issue=issue,
            cycle_id=cycle_id,
            module_ids=module_ids,
        )
        persist_work_item_property_values(
            issue=issue,
            property_values=property_values,
        )
        return issue

    @transaction.atomic
    def update(self, instance, validated_data):
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)
        cycle_id = validated_data.pop("cycle_id", MISSING)
        module_ids = validated_data.pop("module_ids", MISSING)
        property_values = validated_data.pop("property_values")

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        # Time updation occues even when other related models are updated
        instance.updated_at = timezone.now()
        instance = super().update(instance, validated_data)
        sync_issue_cycle_and_modules(
            issue=instance,
            cycle_id=cycle_id,
            module_ids=module_ids,
        )
        persist_work_item_property_values(
            issue=instance,
            property_values=property_values,
        )
        return instance


class CommentReactionSerializer(BaseSerializer):
    class Meta:
        model = CommentReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "comment", "actor"]


class IssueVoteSerializer(BaseSerializer):
    class Meta:
        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor"]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "sequence_id",
            "state",
            "project",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
            "module_ids",
            "created_by",
            "label_ids",
            "assignee_ids",
        ]
        read_only_fields = fields


class LabelLiteSerializer(BaseSerializer):
    class Meta:
        model = Label
        fields = ["id", "name", "color"]
