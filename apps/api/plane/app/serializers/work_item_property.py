# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date
from uuid import UUID, uuid4

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from plane.db.models import (
    BUILT_IN_WORK_ITEM_FIELD_KEYS,
    LOCKED_REQUIRED_WORK_ITEM_FIELD_KEYS,
    LOCKED_VISIBLE_WORK_ITEM_FIELD_KEYS,
    ProjectWorkItemFieldConfiguration,
    ProjectWorkItemProperty,
    ProjectWorkItemPropertyOption,
    ProjectMember,
    WorkItemSelectSource,
    WorkItemPropertyType,
    get_default_work_item_field_configuration,
)

from .base import BaseSerializer


SELECT_PROPERTY_TYPES = {
    WorkItemPropertyType.SINGLE_SELECT,
    WorkItemPropertyType.MULTI_SELECT,
}


class ProjectWorkItemFieldConfigurationSerializer(BaseSerializer):
    class Meta:
        model = ProjectWorkItemFieldConfiguration
        fields = [
            "id",
            "project",
            "workspace",
            "built_in_fields",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "project", "workspace", "created_at", "updated_at"]

    def validate_built_in_fields(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Built-in fields must be an object.")

        current = self.instance.built_in_fields if self.instance else get_default_work_item_field_configuration()
        merged = get_default_work_item_field_configuration()

        for field_key, settings in current.items():
            if field_key in merged and isinstance(settings, dict):
                merged[field_key].update(settings)

        unknown_fields = set(value) - set(BUILT_IN_WORK_ITEM_FIELD_KEYS)
        if unknown_fields:
            raise serializers.ValidationError(f"Unknown built-in fields: {', '.join(sorted(unknown_fields))}.")

        for field_key, settings in value.items():
            if not isinstance(settings, dict):
                raise serializers.ValidationError(f"Configuration for '{field_key}' must be an object.")

            unknown_settings = set(settings) - {"visible", "required"}
            if unknown_settings:
                raise serializers.ValidationError(
                    f"Unknown settings for '{field_key}': {', '.join(sorted(unknown_settings))}."
                )

            for setting_name, setting_value in settings.items():
                if not isinstance(setting_value, bool):
                    raise serializers.ValidationError(f"'{field_key}.{setting_name}' must be a boolean.")
                merged[field_key][setting_name] = setting_value

        hidden_locked_fields = [
            field_key for field_key in LOCKED_VISIBLE_WORK_ITEM_FIELD_KEYS if not merged[field_key]["visible"]
        ]
        if hidden_locked_fields:
            raise serializers.ValidationError(f"Fields cannot be hidden: {', '.join(hidden_locked_fields)}.")

        optional_locked_fields = [
            field_key for field_key in LOCKED_REQUIRED_WORK_ITEM_FIELD_KEYS if not merged[field_key]["required"]
        ]
        if optional_locked_fields:
            raise serializers.ValidationError(f"Fields must remain required: {', '.join(optional_locked_fields)}.")

        for settings in merged.values():
            if not settings["visible"]:
                settings["required"] = False

        return merged


class ProjectWorkItemPropertyOptionSerializer(BaseSerializer):
    id = serializers.UUIDField(required=False)
    is_archived = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = ProjectWorkItemPropertyOption
        fields = [
            "id",
            "name",
            "sort_order",
            "archived_at",
            "is_archived",
        ]
        read_only_fields = ["archived_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Option name cannot be empty.")
        return value


class ProjectWorkItemPropertySerializer(BaseSerializer):
    options = ProjectWorkItemPropertyOptionSerializer(many=True, required=False)

    class Meta:
        model = ProjectWorkItemProperty
        fields = [
            "id",
            "project",
            "workspace",
            "name",
            "description",
            "property_type",
            "select_source",
            "is_required",
            "default_value",
            "sort_order",
            "archived_at",
            "options",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "workspace",
            "archived_at",
            "created_at",
            "updated_at",
        ]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Property name cannot be empty.")

        project = self.context["project"]
        queryset = ProjectWorkItemProperty.objects.filter(
            project=project,
            name__iexact=value,
            archived_at__isnull=True,
        )
        if self.instance:
            queryset = queryset.exclude(id=self.instance.id)
        if queryset.exists():
            raise serializers.ValidationError("An active property with this name already exists.")
        return value

    def validate(self, attrs):
        property_type = attrs.get(
            "property_type",
            self.instance.property_type if self.instance else None,
        )
        if self.instance and property_type != self.instance.property_type:
            raise serializers.ValidationError({"property_type": "Property type cannot be changed after creation."})

        select_source = attrs.get(
            "select_source",
            self.instance.select_source if self.instance else WorkItemSelectSource.MANUAL,
        )
        if self.instance and select_source != self.instance.select_source:
            raise serializers.ValidationError({"select_source": "Select source cannot be changed after creation."})
        if property_type not in SELECT_PROPERTY_TYPES and select_source != WorkItemSelectSource.MANUAL:
            raise serializers.ValidationError({"select_source": "Only select properties can use project members."})

        options = attrs.get("options")
        if options is not None:
            for option in options:
                option.setdefault("id", uuid4())

        is_member_select = property_type in SELECT_PROPERTY_TYPES and select_source == WorkItemSelectSource.MEMBERS
        if property_type not in SELECT_PROPERTY_TYPES and options:
            raise serializers.ValidationError({"options": "Options are only supported by select properties."})
        if is_member_select and options:
            raise serializers.ValidationError({"options": "Project-member selects do not use manual options."})

        active_option_ids = self._future_active_option_ids(options)
        if property_type in SELECT_PROPERTY_TYPES and not is_member_select and not active_option_ids:
            raise serializers.ValidationError({"options": "Select properties require at least one active option."})

        default_value = attrs.get(
            "default_value",
            self.instance.default_value if self.instance else None,
        )
        self._validate_default_value(
            property_type=property_type,
            select_source=select_source,
            default_value=default_value,
            active_option_ids=active_option_ids,
        )
        return attrs

    def _future_active_option_ids(self, options):
        active_options = {}
        if self.instance:
            active_options = {
                str(option.id): option.name for option in self.instance.options.filter(archived_at__isnull=True)
            }

        for option in options or []:
            option_id = str(option["id"])
            if self.instance and not self.instance.options.filter(id=option["id"]).exists():
                if ProjectWorkItemPropertyOption.all_objects.filter(id=option["id"], deleted_at__isnull=True).exists():
                    raise serializers.ValidationError({"options": f"Option '{option_id}' belongs to another property."})

            if option.get("is_archived", False):
                active_options.pop(option_id, None)
            else:
                active_options[option_id] = option["name"]

        normalized_names = [name.casefold() for name in active_options.values()]
        if len(normalized_names) != len(set(normalized_names)):
            raise serializers.ValidationError({"options": "Active option names must be unique."})
        return set(active_options)

    def _validate_default_value(
        self,
        *,
        property_type,
        select_source,
        default_value,
        active_option_ids,
    ):
        if default_value is None:
            return

        if property_type in {
            WorkItemPropertyType.SHORT_TEXT,
            WorkItemPropertyType.LONG_TEXT,
        }:
            if not isinstance(default_value, str):
                raise serializers.ValidationError({"default_value": "Text defaults must be strings."})
            return

        if property_type == WorkItemPropertyType.NUMBER:
            if isinstance(default_value, bool) or not isinstance(default_value, (int, float)):
                raise serializers.ValidationError({"default_value": "Number defaults must be numeric."})
            return

        if property_type == WorkItemPropertyType.DATE:
            if not isinstance(default_value, str):
                raise serializers.ValidationError({"default_value": "Date defaults must use YYYY-MM-DD."})
            try:
                date.fromisoformat(default_value)
            except ValueError as error:
                raise serializers.ValidationError({"default_value": "Date defaults must use YYYY-MM-DD."}) from error
            return

        if property_type == WorkItemPropertyType.CHECKBOX:
            if not isinstance(default_value, bool):
                raise serializers.ValidationError({"default_value": "Checkbox defaults must be booleans."})
            return

        if property_type == WorkItemPropertyType.SINGLE_SELECT:
            if select_source == WorkItemSelectSource.MEMBERS:
                self._validate_member_default_ids([default_value])
                return
            if str(default_value) not in active_option_ids:
                raise serializers.ValidationError({"default_value": "The default must reference an active option."})
            return

        if property_type == WorkItemPropertyType.MULTI_SELECT:
            if not isinstance(default_value, list):
                raise serializers.ValidationError({"default_value": "Multi-select defaults must be a list."})
            default_ids = [str(option_id) for option_id in default_value]
            if len(default_ids) != len(set(default_ids)):
                raise serializers.ValidationError({"default_value": "Multi-select defaults cannot contain duplicates."})
            if select_source == WorkItemSelectSource.MEMBERS:
                self._validate_member_default_ids(default_ids)
                return
            if not set(default_ids).issubset(active_option_ids):
                raise serializers.ValidationError({"default_value": "Defaults must reference active options."})

    def _validate_member_default_ids(self, member_ids):
        try:
            normalized_member_ids = [str(UUID(str(member_id))) for member_id in member_ids]
        except (TypeError, ValueError, AttributeError) as error:
            raise serializers.ValidationError(
                {"default_value": "Defaults must reference active project members."}
            ) from error

        active_member_ids = {
            str(member_id)
            for member_id in ProjectMember.objects.filter(
                project=self.context["project"],
                is_active=True,
                role__gte=15,
                member__is_active=True,
                member_id__in=normalized_member_ids,
            ).values_list("member_id", flat=True)
        }
        if not set(normalized_member_ids).issubset(active_member_ids):
            raise serializers.ValidationError({"default_value": "Defaults must reference active project members."})

    def _save_options(self, property_instance, options):
        for option_data in options or []:
            option_id = option_data.pop("id")
            archive_state = option_data.pop("is_archived", None)
            option = ProjectWorkItemPropertyOption.all_objects.filter(
                id=option_id,
                property=property_instance,
                deleted_at__isnull=True,
            ).first()

            if option:
                for field_name, field_value in option_data.items():
                    setattr(option, field_name, field_value)
                if archive_state is not None:
                    option.archived_at = timezone.now() if archive_state else None
                option.save()
                continue

            ProjectWorkItemPropertyOption.objects.create(
                id=option_id,
                property=property_instance,
                project=property_instance.project,
                archived_at=timezone.now() if archive_state else None,
                **option_data,
            )

    @transaction.atomic
    def create(self, validated_data):
        options = validated_data.pop("options", [])
        property_instance = ProjectWorkItemProperty.objects.create(**validated_data)
        self._save_options(property_instance, options)
        return property_instance

    @transaction.atomic
    def update(self, instance, validated_data):
        options = validated_data.pop("options", None)
        for field_name, field_value in validated_data.items():
            setattr(instance, field_name, field_value)
        instance.save()
        if options is not None:
            self._save_options(instance, options)
        return instance
