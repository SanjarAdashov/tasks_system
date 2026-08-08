# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import (
    CustomGroupingDateBucket,
    ProjectCustomGrouping,
    ProjectCustomGroupingPreference,
    ProjectWorkItemFieldConfiguration,
    ProjectWorkItemProperty,
    WorkItemPropertyType,
    get_default_work_item_field_configuration,
)

from .base import BaseSerializer


SUPPORTED_SYSTEM_GROUPS = {
    "state": "state",
    "priority": "priority",
    "assignees": "assignees",
    "labels": "labels",
    "cycle": "cycle",
    "module": "module",
    "created_by": None,
    "start_date": "start_date",
    "target_date": "target_date",
}
SUPPORTED_CUSTOM_TYPES = {
    WorkItemPropertyType.DATE,
    WorkItemPropertyType.CHECKBOX,
    WorkItemPropertyType.SINGLE_SELECT,
    WorkItemPropertyType.MULTI_SELECT,
}
DATE_SYSTEM_GROUPS = {"start_date", "target_date"}


def is_custom_grouping_field_available(project, group_by):
    built_in_field = SUPPORTED_SYSTEM_GROUPS.get(group_by, "unsupported")
    if built_in_field != "unsupported":
        if built_in_field is None:
            return True
        configuration = ProjectWorkItemFieldConfiguration.objects.filter(project=project).first()
        built_in_fields = (
            configuration.built_in_fields if configuration else get_default_work_item_field_configuration()
        )
        settings = built_in_fields.get(
            built_in_field, {}
        )
        return settings.get("visible", True)

    prefix = "customproperty_"
    if not isinstance(group_by, str) or not group_by.startswith(prefix):
        return False
    property_id = group_by.removeprefix(prefix)
    return ProjectWorkItemProperty.objects.filter(
        id=property_id,
        project=project,
        archived_at__isnull=True,
        property_type__in=SUPPORTED_CUSTOM_TYPES,
    ).exists()


def custom_grouping_is_date(project, group_by):
    if group_by in DATE_SYSTEM_GROUPS:
        return True
    if not isinstance(group_by, str) or not group_by.startswith("customproperty_"):
        return False
    return ProjectWorkItemProperty.objects.filter(
        id=group_by.removeprefix("customproperty_"),
        project=project,
        archived_at__isnull=True,
        property_type=WorkItemPropertyType.DATE,
    ).exists()


class ProjectCustomGroupingSerializer(BaseSerializer):
    owned_by = serializers.UUIDField(source="owned_by_id", read_only=True)
    owner_name = serializers.CharField(source="owned_by.display_name", read_only=True)

    class Meta:
        model = ProjectCustomGrouping
        fields = [
            "id",
            "name",
            "group_by",
            "date_bucket",
            "access",
            "owned_by",
            "owner_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "owned_by", "owner_name", "created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Configuration name is required.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = self.context["project"]
        group_by = attrs.get("group_by", getattr(self.instance, "group_by", None))
        date_bucket = attrs.get("date_bucket", getattr(self.instance, "date_bucket", None))
        if not is_custom_grouping_field_available(project, group_by):
            raise serializers.ValidationError({"group_by": "This field is unavailable for grouping in the project."})
        if custom_grouping_is_date(project, group_by):
            if not date_bucket:
                attrs["date_bucket"] = CustomGroupingDateBucket.EXACT
        else:
            attrs["date_bucket"] = None
        return attrs


class ProjectCustomGroupingPreferenceSerializer(BaseSerializer):
    active_grouping = serializers.PrimaryKeyRelatedField(
        queryset=ProjectCustomGrouping.objects.all(),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = ProjectCustomGroupingPreference
        fields = ["active_grouping", "collapsed_groups"]

    def validate_active_grouping(self, grouping):
        if grouping is None:
            return grouping
        project = self.context["project"]
        user = self.context["request"].user
        if grouping.project_id != project.id or (
            grouping.access == "PERSONAL" and grouping.owned_by_id != user.id
        ):
            raise serializers.ValidationError("This grouping configuration is not available to you.")
        return grouping

    def validate_collapsed_groups(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Collapsed groups must be an object.")
        if any(
            not isinstance(configuration_id, str)
            or not isinstance(groups, list)
            or any(not isinstance(group_id, str) for group_id in groups)
            for configuration_id, groups in value.items()
        ):
            raise serializers.ValidationError("Collapsed groups contain invalid values.")
        return value
