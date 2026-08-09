# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from plane.db.models import (
    IntakeForm,
    IntakeFormAccessType,
    ProjectUserGroup,
    ProjectWorkItemProperty,
    State,
    WorkItemSelectSource,
)
from plane.utils.intake_forms import normalize_intake_form_slug, suggest_intake_form_slugs
from plane.utils.work_item_fields import _validate_property_value

from .base import BaseSerializer


FORM_FIELD_KEYS = {"requester_name", "requester_email"}
SYSTEM_FIELD_KEYS = {"title", "description", "priority"}
CONDITION_OPERATORS = {"EQUALS", "NOT_EQUALS", "CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY"}


class IntakeFormSerializer(BaseSerializer):
    slug = serializers.CharField(max_length=120)
    title_template = serializers.CharField(max_length=500, required=False, allow_blank=True)
    access_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_access_code = serializers.SerializerMethodField()
    public_path = serializers.SerializerMethodField()
    submission_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = IntakeForm
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "is_enabled",
            "archived_at",
            "access_type",
            "access_code",
            "has_access_code",
            "public_path",
            "target_state",
            "reviewer_group",
            "field_schema",
            "hidden_values",
            "conditions",
            "branding",
            "translations",
            "public_status_mapping",
            "title_template",
            "email_notifications_enabled",
            "max_attachments",
            "submission_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "archived_at", "has_access_code", "public_path", "created_at", "updated_at"]

    def get_has_access_code(self, obj):
        return bool(obj.access_code_hash)

    def get_public_path(self, obj):
        return f"/support/{obj.slug}"

    def validate_slug(self, value):
        normalized = normalize_intake_form_slug(value)
        if not normalized:
            raise serializers.ValidationError("Enter a URL using letters, numbers, or hyphens.")
        queryset = IntakeForm.objects.filter(slug__iexact=normalized, deleted_at__isnull=True)
        if self.instance:
            queryset = queryset.exclude(id=self.instance.id)
        if queryset.exists():
            suggestions = suggest_intake_form_slugs(normalized, exclude_id=getattr(self.instance, "id", None))
            raise serializers.ValidationError(
                {"message": "This public URL is already in use.", "suggestions": suggestions}
            )
        return normalized

    def validate_target_state(self, value):
        if value and not State.objects.filter(id=value.id, project=self.context["project"], is_triage=False).exists():
            raise serializers.ValidationError("Select an active non-triage state from this project.")
        return value

    def validate_reviewer_group(self, value):
        if value and not ProjectUserGroup.objects.filter(
            id=value.id,
            project=self.context["project"],
            archived_at__isnull=True,
        ).exists():
            raise serializers.ValidationError("Select an active user group from this project.")
        return value

    def validate_field_schema(self, value):
        if not isinstance(value, list) or len(value) > 100:
            raise serializers.ValidationError("Fields must be a list containing no more than 100 items.")
        ids = []
        custom_property_ids = []
        for index, field in enumerate(value):
            if not isinstance(field, dict):
                raise serializers.ValidationError(f"Field {index + 1} must be an object.")
            field_id = str(field.get("id", "")).strip()
            source = field.get("source")
            key = str(field.get("key", "")).strip()
            if not field_id or source not in {"FORM", "SYSTEM", "CUSTOM"}:
                raise serializers.ValidationError(f"Field {index + 1} has an invalid id or source.")
            ids.append(field_id)
            if source == "FORM" and key not in FORM_FIELD_KEYS:
                raise serializers.ValidationError(f"Unsupported form field: {key}.")
            if source == "SYSTEM" and key not in SYSTEM_FIELD_KEYS:
                raise serializers.ValidationError(f"Unsupported public system field: {key}.")
            if source == "CUSTOM":
                property_id = str(field.get("property_id", ""))
                if not property_id:
                    raise serializers.ValidationError("Custom fields must reference a project property.")
                custom_property_ids.append(property_id)
            field["visible"] = bool(field.get("visible", True))
            field["required"] = bool(field.get("required", False))
            field["sort_order"] = int(field.get("sort_order", (index + 1) * 1000))
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Field ids must be unique.")

        properties = {
            str(item.id): item
            for item in ProjectWorkItemProperty.objects.filter(
                project=self.context["project"],
                id__in=custom_property_ids,
                archived_at__isnull=True,
            )
        }
        if set(custom_property_ids) != set(properties):
            raise serializers.ValidationError("Every custom field must reference an active project property.")
        member_properties = [
            property_id
            for property_id, item in properties.items()
            if item.select_source == WorkItemSelectSource.MEMBERS
        ]
        if member_properties:
            raise serializers.ValidationError(
                {"member_properties": member_properties, "message": "Employee lists cannot be exposed publicly."}
            )
        return sorted(value, key=lambda item: item["sort_order"])

    def validate_conditions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Conditions must be a list.")
        schema = self.initial_data.get("field_schema")
        if schema is None and self.instance:
            schema = self.instance.field_schema
        field_ids = {str(field["id"]) for field in (schema or [])}
        for condition in value:
            if condition.get("match", "ALL") not in {"ALL", "ANY"}:
                raise serializers.ValidationError("Condition groups support ALL or ANY matching.")
            if condition.get("action", "SHOW") not in {"SHOW", "HIDE"}:
                raise serializers.ValidationError("Conditions support SHOW or HIDE actions.")
            if str(condition.get("target_field_id", "")) not in field_ids:
                raise serializers.ValidationError("A condition references an unknown target field.")
            for rule in condition.get("rules", []):
                if str(rule.get("field_id", "")) not in field_ids:
                    raise serializers.ValidationError("A condition references an unknown source field.")
                if rule.get("operator", "EQUALS") not in CONDITION_OPERATORS:
                    raise serializers.ValidationError("A condition uses an unsupported operator.")
        return value

    def validate_hidden_values(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Hidden values must be an object.")
        priority = value.get("priority")
        if priority is not None and priority not in {"none", "low", "medium", "high", "urgent"}:
            raise serializers.ValidationError({"priority": "Select a valid priority."})
        property_values = value.get("property_values", {})
        if not isinstance(property_values, dict):
            raise serializers.ValidationError({"property_values": "Property values must be an object."})
        properties = {
            str(item.id): item
            for item in ProjectWorkItemProperty.objects.filter(
                project=self.context["project"],
                id__in=property_values,
                archived_at__isnull=True,
            ).prefetch_related("options")
        }
        if set(property_values) != set(properties):
            raise serializers.ValidationError({"property_values": "A hidden property is no longer available."})
        normalized = {}
        for property_id, property_value in property_values.items():
            property_instance = properties[property_id]
            if property_instance.select_source == WorkItemSelectSource.MEMBERS:
                raise serializers.ValidationError(
                    {"property_values": "Employee-backed fields cannot be used in a public form."}
                )
            try:
                normalized[property_id] = _validate_property_value(
                    property_instance,
                    property_value,
                    allow_archived_options=False,
                )
            except ValueError as error:
                raise serializers.ValidationError({"property_values": {property_id: str(error)}}) from error
        if property_values:
            value["property_values"] = normalized
        return value

    def validate(self, attrs):
        access_type = attrs.get(
            "access_type",
            self.instance.access_type if self.instance else IntakeFormAccessType.PUBLIC,
        )
        access_code = attrs.pop("access_code", None)
        if access_type == IntakeFormAccessType.CODE and not access_code and not (
            self.instance and self.instance.access_code_hash
        ):
            raise serializers.ValidationError({"access_code": "Set or generate an access code."})
        if access_code is not None:
            if access_code and len(access_code) < 6:
                raise serializers.ValidationError({"access_code": "Access codes must contain at least 6 characters."})
            attrs["access_code_hash"] = make_password(access_code) if access_code else ""
        if access_type != IntakeFormAccessType.CODE:
            attrs["access_code_hash"] = ""

        schema = attrs.get("field_schema", self.instance.field_schema if self.instance else [])
        title_field = next((field for field in (schema or []) if field.get("key") == "title"), None)
        title_template = attrs.get("title_template", self.instance.title_template if self.instance else "")
        if (not title_field or not title_field.get("visible", True)) and not title_template.strip():
            raise serializers.ValidationError(
                {"title_template": "Set a title template when the title field is hidden."}
            )
        target_state = attrs.get("target_state", self.instance.target_state if self.instance else None)
        if target_state is None:
            raise serializers.ValidationError({"target_state": "Select the status used for accepted requests."})
        reviewer_group = attrs.get("reviewer_group", self.instance.reviewer_group if self.instance else None)
        if reviewer_group is None:
            raise serializers.ValidationError({"reviewer_group": "Select one group to review requests."})
        email_enabled = attrs.get(
            "email_notifications_enabled",
            self.instance.email_notifications_enabled if self.instance else False,
        )
        if email_enabled:
            email_field = next((field for field in (schema or []) if field.get("key") == "requester_email"), None)
            if not email_field or not email_field.get("visible", True) or not email_field.get("required", False):
                raise serializers.ValidationError(
                    {"field_schema": "Requester email must be visible and required when email notifications are on."}
                )
        return attrs
