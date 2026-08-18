# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.utils import timezone
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from crum import get_current_user

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer
from .state import StateLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueActivity,
    IssueComment,
    ProjectUserProperty,
    IssueAssignee,
    IssueSubscriber,
    IssueLabel,
    Label,
    CycleIssue,
    Cycle,
    Module,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
    State,
    IssueVersion,
    IssueDescriptionVersion,
    ProjectMember,
    EstimatePoint,
    Project,
    IssueAccessAuditAction,
    IssueAccessGroup,
    IssueAccessSourceType,
    IssueVisibility,
    ProjectUserGroupMember,
    ProjectWorkItemProperty,
    WorkItemSelectSource,
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
from plane.utils.state_transition_rules import enforce_state_transition
from plane.utils.issue_access import (
    administrative_user_ids,
    can_manage_issue_access,
    issue_access_summary,
    issue_effective_user_ids,
    normalize_uuid_set,
    propagate_inherited_access,
    record_issue_access_event,
    sync_issue_access_groups,
    validate_issue_access_groups,
    unauthorized_mention_user_ids,
    extract_mentioned_user_ids,
)


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


class IssueProjectLiteSerializer(BaseSerializer):
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    # ids
    state_id = serializers.PrimaryKeyRelatedField(
        source="state", queryset=State.all_state_objects.all(), required=False, allow_null=True
    )
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent", queryset=Issue.unscoped_objects.all(), required=False, allow_null=True
    )
    label_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )
    project_id = serializers.UUIDField(source="project.id", read_only=True)
    workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)
    cycle_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    module_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        allow_null=True,
        required=False,
    )
    property_values = serializers.JSONField(required=False, write_only=True)
    access_group_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        write_only=True,
    )

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
            "completed_at",
            "access_source",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        assignee_ids = self.initial_data.get("assignee_ids")
        data["assignee_ids"] = assignee_ids if assignee_ids else []
        label_ids = self.initial_data.get("label_ids")
        data["label_ids"] = label_ids if label_ids else []
        data["cycle_id"] = CycleIssue.objects.filter(issue=instance).values_list("cycle_id", flat=True).first()
        data["module_ids"] = list(ModuleIssue.objects.filter(issue=instance).values_list("module_id", flat=True))
        data["property_values"] = serialize_work_item_property_values(instance)
        data["access_group_ids"] = list(
            IssueAccessGroup.objects.filter(issue=instance).values_list("group_id", flat=True)
        )
        return data

    def _actor(self):
        request = self.context.get("request")
        return request.user if request else get_current_user()

    def _member_property_values(self, property_values):
        member_property_ids = {
            str(property_id)
            for property_id in ProjectWorkItemProperty.objects.filter(
                project_id=self.context["project_id"],
                select_source=WorkItemSelectSource.MEMBERS,
                archived_at__isnull=True,
            ).values_list("id", flat=True)
        }
        return {
            property_id: property_values.get(property_id)
            for property_id in member_property_ids
            if property_id in property_values
        }

    def _candidate_access_user_ids(self, attrs, access_group_ids):
        actor = self._actor()
        user_ids = {self.instance.created_by_id if self.instance else actor.id}
        assignees = attrs.get("assignee_ids")
        if assignees is None and self.instance:
            assignees = self.instance.issue_assignee.values_list("assignee_id", flat=True)
        elif assignees is None and self.context.get("default_assignee_id"):
            assignees = [self.context["default_assignee_id"]]
        user_ids.update(normalize_uuid_set(assignees or []))
        for value in self._member_property_values(attrs["property_values"]).values():
            user_ids.update(normalize_uuid_set(value if isinstance(value, list) else [value]))
        group_member_ids = set(
            ProjectUserGroupMember.objects.filter(
                group_id__in=access_group_ids,
                project_id=self.context["project_id"],
                member__is_active=True,
            ).values_list("member_id", flat=True)
        )
        active_member_ids = set(
            ProjectMember.objects.filter(
                project_id=self.context["project_id"],
                member_id__in=group_member_ids,
                member__is_active=True,
                is_active=True,
            ).values_list("member_id", flat=True)
        )
        user_ids.update(active_member_ids)
        return {user_id for user_id in user_ids if user_id}

    def validate(self, attrs):
        allow_triage = self.context.get("allow_triage_state", False)
        state_manager = State.triage_objects if allow_triage else State.objects

        if (
            attrs.get("start_date", None) is not None
            and attrs.get("target_date", None) is not None
            and attrs.get("start_date", None) > attrs.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        # Validate description content for security
        if "description_html" in attrs and attrs["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the attrs with sanitized HTML if available
            if sanitized_html is not None:
                attrs["description_html"] = sanitized_html

        if "description_binary" in attrs and attrs["description_binary"]:
            is_valid, error_msg = validate_binary_data(attrs["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        # Validate assignees are from project
        if attrs.get("assignee_ids", []):
            attrs["assignee_ids"] = ProjectMember.objects.filter(
                project_id=self.context["project_id"],
                role__gte=15,
                member__is_active=True,
                is_active=True,
                member_id__in=attrs["assignee_ids"],
            ).values_list("member_id", flat=True)

        # Validate labels are from project
        if attrs.get("label_ids"):
            label_ids = [label.id for label in attrs["label_ids"]]
            attrs["label_ids"] = list(
                Label.objects.filter(
                    project_id=self.context.get("project_id"),
                    id__in=label_ids,
                ).values_list("id", flat=True)
            )

        # Check state is from the project only else raise validation error
        if (
            attrs.get("state")
            and not state_manager.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("state").id,
            ).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")

        # Check parent issue is from workspace as it can be cross workspace
        if (
            attrs.get("parent")
            and not Issue.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("parent").id,
            ).exists()
        ):
            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")

        if (
            attrs.get("estimate_point")
            and not EstimatePoint.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("estimate_point").id,
            ).exists()
        ):
            raise serializers.ValidationError("Estimate point is not valid please pass a valid estimate_point_id")

        property_values_were_provided = "property_values" in self.initial_data
        property_values = attrs.pop("property_values", MISSING)
        attrs["property_values"] = validate_and_prepare_work_item_fields(
            project_id=self.context["project_id"],
            attrs=attrs,
            instance=self.instance,
            property_values=property_values,
        )
        actor = self._actor()
        access_group_ids = attrs.get("access_group_ids")
        if access_group_ids is None and self.instance:
            access_group_ids = IssueAccessGroup.objects.filter(issue=self.instance).values_list(
                "group_id", flat=True
            )
        access_group_ids = validate_issue_access_groups(
            project_id=self.context["project_id"],
            group_ids=access_group_ids or [],
        )
        attrs["access_group_ids"] = access_group_ids

        if self.instance and not can_manage_issue_access(actor, self.instance):
            restricted_now = self.instance.visibility == IssueVisibility.RESTRICTED
            toggles_access = any(
                field in self.initial_data
                for field in ("visibility", "inherit_parent_access", "parent_id", "access_group_ids")
            )
            current_assignees = set(
                self.instance.issue_assignee.values_list("assignee_id", flat=True)
            )
            next_assignees = normalize_uuid_set(
                attrs.get("assignee_ids", current_assignees)
            )
            assignees_changed = "assignee_ids" in self.initial_data and next_assignees != current_assignees
            member_properties_changed = False
            if property_values_were_provided:
                current_properties = self._member_property_values(
                    serialize_work_item_property_values(self.instance)
                )
                next_properties = self._member_property_values(attrs["property_values"])
                member_properties_changed = current_properties != next_properties
            if toggles_access or (restricted_now and (assignees_changed or member_properties_changed)):
                raise serializers.ValidationError(
                    {"access": "Only the task creator or a Project Admin can change restricted-task access."}
                )

        parent = attrs.get("parent", self.instance.parent if self.instance else None)
        visibility = attrs.get(
            "visibility",
            self.instance.visibility if self.instance else IssueVisibility.PROJECT,
        )
        inherit_parent_access = attrs.get(
            "inherit_parent_access",
            self.instance.inherit_parent_access if self.instance else True,
        )
        if parent and parent.visibility == IssueVisibility.RESTRICTED:
            if "visibility" not in self.initial_data and (
                not self.instance or parent.id != self.instance.parent_id
            ):
                visibility = IssueVisibility.RESTRICTED
                attrs["visibility"] = visibility
            if visibility != IssueVisibility.RESTRICTED:
                raise serializers.ValidationError(
                    {"visibility": "A child of a restricted task must also be restricted."}
                )
            attrs["access_source"] = (
                parent.access_source if parent.access_source_id else parent
            ) if inherit_parent_access else None
            candidate_ids = self._candidate_access_user_ids(attrs, access_group_ids)
            if not candidate_ids.issubset(issue_effective_user_ids(parent)):
                raise serializers.ValidationError(
                    {"access": "A child task cannot grant access beyond its restricted parent."}
                )
        else:
            attrs["access_source"] = None

        if visibility == IssueVisibility.RESTRICTED and attrs.get("description_html"):
            if parent and parent.visibility == IssueVisibility.RESTRICTED and inherit_parent_access:
                allowed_ids = issue_effective_user_ids(parent)
            else:
                allowed_ids = self._candidate_access_user_ids(attrs, access_group_ids)
            allowed_ids |= administrative_user_ids(
                project_id=self.context["project_id"],
                workspace_id=(
                    self.instance.workspace_id
                    if self.instance
                    else self.context["workspace_id"]
                ),
            )
            unauthorized_ids = extract_mentioned_user_ids(attrs["description_html"]) - allowed_ids
            if unauthorized_ids:
                raise serializers.ValidationError(
                    {
                        "mentions": {
                            "code": "restricted_task_access_required",
                            "user_ids": sorted(str(value) for value in unauthorized_ids),
                            "can_grant": "true"
                            if not self.instance or can_manage_issue_access(actor, self.instance)
                            else "false",
                        }
                    }
                )

        if (
            self.instance
            and visibility != self.instance.visibility
            and not can_manage_issue_access(actor, self.instance)
        ):
            raise serializers.ValidationError(
                {"visibility": "Only the task creator or a Project Admin can change visibility."}
            )
        request = self.context.get("request")
        enforce_state_transition(
            project=Project.objects.get(id=self.context["project_id"]),
            actor=request.user if request else get_current_user(),
            issue=self.instance,
            attrs=attrs,
            is_system=self.context.get("is_system_operation", False),
        )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)
        cycle_id = validated_data.pop("cycle_id", MISSING)
        module_ids = validated_data.pop("module_ids", MISSING)
        property_values = validated_data.pop("property_values")
        access_group_ids = validated_data.pop("access_group_ids", set())

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        # Create Issue
        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass
        else:
            # Then assign it to default assignee, if it is a valid assignee
            if (
                default_assignee_id is not None
                and ProjectMember.objects.filter(
                    member_id=default_assignee_id,
                    project_id=project_id,
                    role__gte=15,
                    is_active=True,
                    member__is_active=True,
                ).exists()
            ):
                try:
                    IssueAssignee.objects.create(
                        assignee_id=default_assignee_id,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                except IntegrityError:
                    pass

        if labels is not None and len(labels):
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass

        sync_issue_cycle_and_modules(
            issue=issue,
            cycle_id=cycle_id,
            module_ids=module_ids,
        )
        persist_work_item_property_values(
            issue=issue,
            property_values=property_values,
        )
        sync_issue_access_groups(
            issue=issue,
            group_ids=access_group_ids,
            actor=self._actor(),
        )
        if issue.visibility == IssueVisibility.RESTRICTED:
            record_issue_access_event(
                issue=issue,
                actor=self._actor(),
                action=IssueAccessAuditAction.VISIBILITY_CHANGED,
                source_type=IssueAccessSourceType.VISIBILITY,
                details={"from": IssueVisibility.PROJECT, "to": IssueVisibility.RESTRICTED},
            )
        if issue.access_source_id:
            record_issue_access_event(
                issue=issue,
                actor=self._actor(),
                action=IssueAccessAuditAction.PARENT_ACCESS_APPLIED,
                source_type=IssueAccessSourceType.PARENT,
                source_id=issue.parent_id,
                details={"access_source_id": str(issue.access_source_id)},
            )
        return issue

    @transaction.atomic
    def update(self, instance, validated_data):
        previous_visibility = instance.visibility
        previous_parent_id = instance.parent_id
        previous_access_source_id = instance.access_source_id
        previous_assignees = set(instance.issue_assignee.values_list("assignee_id", flat=True))
        previous_member_properties = self._member_property_values(
            serialize_work_item_property_values(instance)
        )
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)
        cycle_id = validated_data.pop("cycle_id", MISSING)
        module_ids = validated_data.pop("module_ids", MISSING)
        property_values = validated_data.pop("property_values")
        access_group_ids = validated_data.pop("access_group_ids", None)

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

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
        if access_group_ids is not None:
            sync_issue_access_groups(
                issue=instance,
                group_ids=access_group_ids,
                actor=self._actor(),
            )
        if previous_visibility != instance.visibility:
            record_issue_access_event(
                issue=instance,
                actor=self._actor(),
                action=IssueAccessAuditAction.VISIBILITY_CHANGED,
                source_type=IssueAccessSourceType.VISIBILITY,
                details={"from": previous_visibility, "to": instance.visibility},
            )
        if (
            previous_parent_id != instance.parent_id
            or previous_access_source_id != instance.access_source_id
        ):
            record_issue_access_event(
                issue=instance,
                actor=self._actor(),
                action=IssueAccessAuditAction.PARENT_ACCESS_APPLIED,
                source_type=IssueAccessSourceType.PARENT,
                source_id=instance.parent_id,
                details={
                    "previous_parent_id": str(previous_parent_id) if previous_parent_id else None,
                    "parent_id": str(instance.parent_id) if instance.parent_id else None,
                    "previous_access_source_id": (
                        str(previous_access_source_id) if previous_access_source_id else None
                    ),
                    "access_source_id": str(instance.access_source_id) if instance.access_source_id else None,
                },
            )
        current_assignees = set(instance.issue_assignee.values_list("assignee_id", flat=True))
        if previous_assignees != current_assignees:
            record_issue_access_event(
                issue=instance,
                actor=self._actor(),
                action=IssueAccessAuditAction.ASSIGNEES_CHANGED,
                source_type=IssueAccessSourceType.ASSIGNEE,
                details={
                    "added_user_ids": sorted(str(value) for value in current_assignees - previous_assignees),
                    "removed_user_ids": sorted(str(value) for value in previous_assignees - current_assignees),
                },
            )
        current_member_properties = self._member_property_values(
            serialize_work_item_property_values(instance)
        )
        if previous_member_properties != current_member_properties:
            record_issue_access_event(
                issue=instance,
                actor=self._actor(),
                action=IssueAccessAuditAction.MEMBER_PROPERTIES_CHANGED,
                source_type=IssueAccessSourceType.MEMBER_PROPERTY,
                details={"property_ids": sorted(set(previous_member_properties) | set(current_member_properties))},
            )
        if instance.visibility == IssueVisibility.RESTRICTED:
            propagate_inherited_access(instance)
        return instance


class IssueActivitySerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    source_data = serializers.SerializerMethodField()

    def get_source_data(self, obj):
        if hasattr(obj, "issue") and hasattr(obj.issue, "source_data") and obj.issue.source_data:
            return {
                "source": obj.issue.source_data[0].source,
                "source_email": obj.issue.source_data[0].source_email,
                "extra": obj.issue.source_data[0].extra,
            }
        return None

    class Meta:
        model = IssueActivity
        fields = "__all__"


class ProjectUserPropertySerializer(BaseSerializer):
    class Meta:
        model = ProjectUserProperty
        fields = "__all__"
        read_only_fields = ["user", "workspace", "project"]


class LabelSerializer(BaseSerializer):
    class Meta:
        model = Label
        fields = [
            "parent",
            "name",
            "color",
            "id",
            "project_id",
            "workspace_id",
            "sort_order",
        ]
        read_only_fields = ["workspace", "project"]

    def validate_name(self, value):
        project_id = self.context.get("project_id")

        label = Label.objects.filter(project_id=project_id, name__iexact=value)

        if self.instance:
            label = label.exclude(id=self.instance.pk)

        if label.exists():
            raise serializers.ValidationError(detail="LABEL_NAME_ALREADY_EXISTS")

        return value


class LabelLiteSerializer(BaseSerializer):
    class Meta:
        model = Label
        fields = ["id", "name", "color"]


class IssueLabelSerializer(BaseSerializer):
    class Meta:
        model = IssueLabel
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueRelationSerializer(BaseSerializer):
    id = serializers.UUIDField(source="related_issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="related_issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="related_issue.sequence_id", read_only=True)
    name = serializers.CharField(source="related_issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="related_issue.state.id", read_only=True)
    priority = serializers.CharField(source="related_issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class RelatedIssueSerializer(BaseSerializer):
    id = serializers.UUIDField(source="issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True)
    name = serializers.CharField(source="issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="issue.state.id", read_only=True)
    priority = serializers.CharField(source="issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class IssueAssigneeSerializer(BaseSerializer):
    assignee_details = UserLiteSerializer(read_only=True, source="assignee")

    class Meta:
        model = IssueAssignee
        fields = "__all__"


class CycleBaseSerializer(BaseSerializer):
    class Meta:
        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


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


class ModuleBaseSerializer(BaseSerializer):
    class Meta:
        model = Module
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

    def to_internal_value(self, data):
        # Modify the URL before validation by appending http:// if missing
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        # Use Django's built-in URLValidator for validation
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    # Validation if url already exists
    def create(self, validated_data):
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)

    def update(self, instance, validated_data):
        if (
            IssueLink.objects.filter(url=validated_data.get("url"), issue_id=instance.issue_id)
            .exclude(pk=instance.id)
            .exists()
        ):
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})

        return super().update(instance, validated_data)


class IssueLinkLiteSerializer(BaseSerializer):
    class Meta:
        model = IssueLink
        fields = [
            "id",
            "issue_id",
            "title",
            "url",
            "metadata",
            "created_by_id",
            "created_at",
        ]
        read_only_fields = fields


class IssueAttachmentSerializer(BaseSerializer):
    asset_url = serializers.CharField(read_only=True)

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


class IssueAttachmentLiteSerializer(DynamicBaseSerializer):
    class Meta:
        model = FileAsset
        fields = [
            "id",
            "asset",
            "attributes",
            # "issue_id",
            "created_by",
            "updated_at",
            "updated_by",
            "asset_url",
        ]
        read_only_fields = fields


class IssueReactionSerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = IssueReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue", "actor", "deleted_at"]


class IssueReactionLiteSerializer(DynamicBaseSerializer):
    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = IssueReaction
        fields = ["id", "actor", "issue", "reaction", "display_name"]


class CommentReactionSerializer(BaseSerializer):
    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = CommentReaction
        fields = [
            "id",
            "actor",
            "comment",
            "reaction",
            "display_name",
            "deleted_at",
            "workspace",
            "project",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "comment", "actor", "deleted_at", "created_by", "updated_by"]


class IssueVoteSerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor", "actor_detail"]
        read_only_fields = fields


class IssueCommentSerializer(BaseSerializer):
    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionSerializer(read_only=True, many=True)
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

    def validate(self, attrs):
        if "comment_html" in attrs and attrs["comment_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["comment_html"])
            if not is_valid:
                raise serializers.ValidationError({"comment_html": "HTML content is not valid"})
            if sanitized_html is not None:
                attrs["comment_html"] = sanitized_html
        issue = self.context.get("issue") or (self.instance.issue if self.instance else None)
        if issue and "comment_html" in attrs:
            unauthorized_ids = unauthorized_mention_user_ids(issue, attrs["comment_html"])
            if unauthorized_ids:
                request = self.context.get("request")
                raise serializers.ValidationError(
                    {
                        "mentions": {
                            "code": "restricted_task_access_required",
                            "user_ids": sorted(str(value) for value in unauthorized_ids),
                            "can_grant": "true"
                            if can_manage_issue_access(
                                request.user if request else get_current_user(), issue
                            )
                            else "false",
                        }
                    }
                )
        return attrs


class IssueStateFlatSerializer(BaseSerializer):
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


# Issue Serializer with state details
class IssueStateSerializer(DynamicBaseSerializer):
    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Issue
        fields = "__all__"


class IssueIntakeSerializer(DynamicBaseSerializer):
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "priority",
            "sequence_id",
            "project_id",
            "created_at",
            "label_ids",
            "created_by",
        ]
        read_only_fields = fields


class IssueSerializer(DynamicBaseSerializer):
    # ids
    cycle_id = serializers.PrimaryKeyRelatedField(read_only=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Many to many
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Count items
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)
    property_values = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "state_id",
            "sort_order",
            "completed_at",
            "estimate_point",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "project_id",
            "parent_id",
            "cycle_id",
            "module_ids",
            "label_ids",
            "assignee_ids",
            "sub_issues_count",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "attachment_count",
            "link_count",
            "is_draft",
            "archived_at",
            "property_values",
            "visibility",
            "inherit_parent_access",
            "access_source_id",
        ]
        read_only_fields = fields

    def get_property_values(self, obj):
        return serialize_work_item_property_values(obj)

    def validate(self, data):
        if (
            data.get("state_id")
            and not State.objects.filter(project_id=self.context.get("project_id"), pk=data.get("state_id")).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")
        return data


class IssueListDetailSerializer(serializers.Serializer):
    def __init__(self, *args, **kwargs):
        # Extract expand parameter and store it as instance variable
        self.expand = kwargs.pop("expand", []) or []
        # Extract fields parameter and store it as instance variable
        self.fields = kwargs.pop("fields", []) or []
        super().__init__(*args, **kwargs)

    def get_module_ids(self, obj):
        return [module.module_id for module in obj.issue_module.all()]

    def get_label_ids(self, obj):
        return [label.label_id for label in obj.label_issue.all()]

    def get_assignee_ids(self, obj):
        return [assignee.assignee_id for assignee in obj.issue_assignee.all()]

    def to_representation(self, instance):
        data = {
            # Basic fields
            "id": instance.id,
            "name": instance.name,
            "state_id": instance.state_id,
            "sort_order": instance.sort_order,
            "completed_at": instance.completed_at,
            "estimate_point": instance.estimate_point_id,
            "priority": instance.priority,
            "start_date": instance.start_date,
            "target_date": instance.target_date,
            "sequence_id": instance.sequence_id,
            "project_id": instance.project_id,
            "parent_id": instance.parent_id,
            "created_at": instance.created_at,
            "updated_at": instance.updated_at,
            "created_by": instance.created_by_id,
            "updated_by": instance.updated_by_id,
            "is_draft": instance.is_draft,
            "archived_at": instance.archived_at,
            "visibility": instance.visibility,
            "inherit_parent_access": instance.inherit_parent_access,
            "access_source_id": instance.access_source_id,
            # Computed fields
            "cycle_id": instance.cycle_id,
            "module_ids": self.get_module_ids(instance),
            "label_ids": self.get_label_ids(instance),
            "assignee_ids": self.get_assignee_ids(instance),
            "sub_issues_count": instance.sub_issues_count,
            "attachment_count": instance.attachment_count,
            "link_count": instance.link_count,
            "property_values": serialize_work_item_property_values(instance),
        }

        # Handle expanded fields only when requested - using direct field access
        if self.expand:
            if "issue_relation" in self.expand:
                relations = []
                for relation in instance.issue_relation.all():
                    related_issue = relation.related_issue
                    # If the related issue is deleted, skip it
                    if not related_issue:
                        continue
                    # Add the related issue to the relations list
                    relations.append(
                        {
                            "id": related_issue.id,
                            "project_id": related_issue.project_id,
                            "sequence_id": related_issue.sequence_id,
                            "name": related_issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": related_issue.state_id,
                            "priority": related_issue.priority,
                            "created_by": related_issue.created_by_id,
                            "created_at": related_issue.created_at,
                            "updated_at": related_issue.updated_at,
                            "updated_by": related_issue.updated_by_id,
                        }
                    )
                data["issue_relation"] = relations

            if "issue_related" in self.expand:
                related = []
                for relation in instance.issue_related.all():
                    issue = relation.issue
                    # If the related issue is deleted, skip it
                    if not issue:
                        continue
                    # Add the related issue to the related list
                    related.append(
                        {
                            "id": issue.id,
                            "project_id": issue.project_id,
                            "sequence_id": issue.sequence_id,
                            "name": issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": issue.state_id,
                            "priority": issue.priority,
                            "created_by": issue.created_by_id,
                            "created_at": issue.created_at,
                            "updated_at": issue.updated_at,
                            "updated_by": issue.updated_by_id,
                        }
                    )
                data["issue_related"] = related

        return data


class IssueLiteSerializer(DynamicBaseSerializer):
    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "project_id"]
        read_only_fields = fields


class IssueDetailSerializer(IssueSerializer):
    description_html = serializers.CharField()
    is_subscribed = serializers.BooleanField(read_only=True)
    is_intake = serializers.BooleanField(read_only=True)
    access_group_ids = serializers.SerializerMethodField()
    access_summary = serializers.SerializerMethodField()
    can_manage_access = serializers.SerializerMethodField()

    def get_access_group_ids(self, obj):
        return list(IssueAccessGroup.objects.filter(issue=obj).values_list("group_id", flat=True))

    def get_access_summary(self, obj):
        return issue_access_summary(obj) if obj.visibility == IssueVisibility.RESTRICTED else None

    def get_can_manage_access(self, obj):
        request = self.context.get("request")
        return can_manage_issue_access(request.user if request else get_current_user(), obj)

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + [
            "description_html",
            "is_subscribed",
            "is_intake",
            "access_group_ids",
            "access_summary",
            "can_manage_access",
        ]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateLiteSerializer(read_only=True, source="state")
    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "description_html",
            "sequence_id",
            "state",
            "state_detail",
            "project",
            "project_detail",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
        ]
        read_only_fields = fields


class IssueSubscriberSerializer(BaseSerializer):
    class Meta:
        model = IssueSubscriber
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue"]


class IssueVersionDetailSerializer(BaseSerializer):
    class Meta:
        model = IssueVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "parent",
            "state",
            "estimate_point",
            "name",
            "priority",
            "start_date",
            "target_date",
            "assignees",
            "sequence_id",
            "labels",
            "sort_order",
            "completed_at",
            "archived_at",
            "is_draft",
            "external_source",
            "external_id",
            "type",
            "cycle",
            "modules",
            "meta",
            "name",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]


class IssueDescriptionVersionDetailSerializer(BaseSerializer):
    class Meta:
        model = IssueDescriptionVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "description_binary",
            "description_html",
            "description_stripped",
            "description_json",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]
