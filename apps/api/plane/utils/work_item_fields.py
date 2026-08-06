# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date
from uuid import UUID

from django.db import transaction
from django.utils.html import strip_tags
from rest_framework import serializers

from plane.db.models import (
    Cycle,
    CycleIssue,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    ProjectWorkItemFieldConfiguration,
    ProjectWorkItemProperty,
    State,
    WorkItemSelectSource,
    WorkItemPropertyType,
    WorkItemPropertyValue,
    get_default_work_item_field_configuration,
)


MISSING = object()
SELECT_PROPERTY_TYPES = {
    WorkItemPropertyType.SINGLE_SELECT,
    WorkItemPropertyType.MULTI_SELECT,
}


def _canonical_id(value):
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError("Expected a UUID.") from error


def _is_empty(value, *, property_type=None):
    if value is None:
        return True
    if property_type == WorkItemPropertyType.CHECKBOX:
        return False
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _validate_property_value(
    property_instance,
    value,
    *,
    allow_archived_options,
    historical_value=None,
):
    if value is None:
        return None

    property_type = property_instance.property_type
    if property_type in {
        WorkItemPropertyType.SHORT_TEXT,
        WorkItemPropertyType.LONG_TEXT,
    }:
        if not isinstance(value, str):
            raise ValueError("Expected text.")
        if property_type == WorkItemPropertyType.SHORT_TEXT and len(value) > 255:
            raise ValueError("Short text cannot exceed 255 characters.")
        return value

    if property_type == WorkItemPropertyType.NUMBER:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Expected a number.")
        return value

    if property_type == WorkItemPropertyType.DATE:
        if not isinstance(value, str):
            raise ValueError("Expected a date in YYYY-MM-DD format.")
        try:
            date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("Expected a date in YYYY-MM-DD format.") from error
        return value

    if property_type == WorkItemPropertyType.CHECKBOX:
        if not isinstance(value, bool):
            raise ValueError("Expected a boolean.")
        return value

    if property_type in SELECT_PROPERTY_TYPES and property_instance.select_source == WorkItemSelectSource.MEMBERS:
        if property_type == WorkItemPropertyType.MULTI_SELECT:
            if not isinstance(value, list):
                raise ValueError("Expected a list of project members.")
            member_values = [_canonical_id(member_id) for member_id in value]
            if len(member_values) != len(set(member_values)):
                raise ValueError("Duplicate project members are not allowed.")
        else:
            member_values = [_canonical_id(value)]

        active_member_ids = {
            str(member_id)
            for member_id in ProjectMember.objects.filter(
                project=property_instance.project,
                is_active=True,
                role__gte=15,
                member__is_active=True,
                member_id__in=member_values,
            ).values_list("member_id", flat=True)
        }
        historical_member_ids = set()
        if historical_value is not None:
            if property_type == WorkItemPropertyType.MULTI_SELECT:
                historical_member_ids = {_canonical_id(member_id) for member_id in historical_value}
            else:
                historical_member_ids = {_canonical_id(historical_value)}
        if not set(member_values).issubset(active_member_ids | historical_member_ids):
            raise ValueError("Expected active project members.")
        return member_values if property_type == WorkItemPropertyType.MULTI_SELECT else member_values[0]

    available_options = property_instance.options.all()
    if not allow_archived_options:
        available_options = available_options.filter(archived_at__isnull=True)
    option_ids = {str(option_id) for option_id in available_options.values_list("id", flat=True)}

    if property_type == WorkItemPropertyType.SINGLE_SELECT:
        option_id = _canonical_id(value)
        if option_id not in option_ids:
            raise ValueError("Expected an active option.")
        return option_id

    if property_type == WorkItemPropertyType.MULTI_SELECT:
        if not isinstance(value, list):
            raise ValueError("Expected a list of options.")
        option_values = [_canonical_id(option_id) for option_id in value]
        if len(option_values) != len(set(option_values)):
            raise ValueError("Duplicate options are not allowed.")
        if not set(option_values).issubset(option_ids):
            raise ValueError("Expected active options.")
        return option_values

    raise ValueError("Unsupported property type.")


def _normalize_property_input(property_values):
    if property_values is MISSING:
        return {}
    if not isinstance(property_values, dict):
        raise serializers.ValidationError({"property_values": "Property values must be an object."})

    normalized = {}
    invalid_keys = {}
    for property_id, value in property_values.items():
        try:
            normalized[_canonical_id(property_id)] = value
        except ValueError as error:
            invalid_keys[str(property_id)] = str(error)
    if invalid_keys:
        raise serializers.ValidationError({"property_values": invalid_keys})
    return normalized


def validate_draft_property_values(*, project_id, property_values):
    if not project_id or property_values is MISSING:
        return {} if property_values is MISSING else property_values

    provided = _normalize_property_input(property_values)
    properties = {
        str(property_instance.id): property_instance
        for property_instance in ProjectWorkItemProperty.objects.filter(
            project_id=project_id,
            archived_at__isnull=True,
        ).prefetch_related("options")
    }
    unknown_ids = set(provided) - set(properties)
    if unknown_ids:
        raise serializers.ValidationError(
            {"property_values": {property_id: "Unknown or archived property." for property_id in sorted(unknown_ids)}}
        )

    normalized = {}
    errors = {}
    for property_id, value in provided.items():
        try:
            normalized[property_id] = _validate_property_value(
                properties[property_id],
                value,
                allow_archived_options=False,
            )
        except ValueError as error:
            errors[property_id] = str(error)
    if errors:
        raise serializers.ValidationError({"property_values": errors})
    return normalized


def _merged_built_in_configuration(project_id):
    merged = get_default_work_item_field_configuration()
    configuration = ProjectWorkItemFieldConfiguration.objects.filter(project_id=project_id).first()
    if not configuration or not isinstance(configuration.built_in_fields, dict):
        return merged

    for field_key, settings in configuration.built_in_fields.items():
        if field_key not in merged or not isinstance(settings, dict):
            continue
        if isinstance(settings.get("visible"), bool):
            merged[field_key]["visible"] = settings["visible"]
        if isinstance(settings.get("required"), bool):
            merged[field_key]["required"] = settings["required"]
        if not merged[field_key]["visible"]:
            merged[field_key]["required"] = False
    return merged


def _provided_value(attrs, *keys):
    for key in keys:
        if key in attrs:
            return attrs[key]
    return MISSING


def _existing_or_provided_relation(instance, provided, related_manager_name):
    if provided is not MISSING:
        return list(provided) if provided is not None else []
    if not instance:
        return []
    return list(getattr(instance, related_manager_name).values_list("id", flat=True))


def _resolve_built_in_value(*, field_key, project, attrs, instance):
    if field_key == "project":
        return project.id
    if field_key == "title":
        value = _provided_value(attrs, "name")
        return instance.name if value is MISSING and instance else value
    if field_key == "description":
        value = _provided_value(attrs, "description_html", "description_json")
        if value is MISSING and instance:
            value = instance.description_html
        if isinstance(value, str):
            return strip_tags(value).replace("&nbsp;", " ").strip()
        return value
    if field_key == "state":
        value = _provided_value(attrs, "state")
        if value is not MISSING:
            return value
        if instance:
            return instance.state_id
        return State.objects.filter(project=project, is_triage=False).values_list("id", flat=True).first()
    if field_key == "priority":
        value = _provided_value(attrs, "priority")
        if value is MISSING and instance:
            value = instance.priority
        return None if value in {MISSING, "none"} else value
    if field_key == "assignees":
        value = _provided_value(attrs, "assignee_ids", "assignees")
        resolved = _existing_or_provided_relation(instance, value, "assignees")
        if resolved or instance or value is not MISSING:
            return resolved
        if (
            project.default_assignee_id
            and ProjectMember.objects.filter(
                project=project,
                member_id=project.default_assignee_id,
                role__gte=15,
                is_active=True,
                member__is_active=True,
            ).exists()
        ):
            return [project.default_assignee_id]
        return []
    if field_key == "labels":
        value = _provided_value(attrs, "label_ids", "labels")
        return _existing_or_provided_relation(instance, value, "labels")
    if field_key in {"start_date", "target_date"}:
        value = _provided_value(attrs, field_key)
        return getattr(instance, field_key) if value is MISSING and instance else value
    if field_key == "cycle":
        value = _provided_value(attrs, "cycle_id")
        if value is not MISSING:
            return value
        if instance:
            return CycleIssue.objects.filter(issue=instance).values_list("cycle_id", flat=True).first()
        return None
    if field_key == "module":
        value = _provided_value(attrs, "module_ids")
        if value is not MISSING:
            return value
        if instance:
            return list(ModuleIssue.objects.filter(issue=instance).values_list("module_id", flat=True))
        return []
    if field_key == "estimate":
        value = _provided_value(attrs, "estimate_point", "point")
        if value is not MISSING:
            return value
        if instance:
            return instance.estimate_point_id or instance.point
        return None
    if field_key == "parent":
        value = _provided_value(attrs, "parent")
        return instance.parent_id if value is MISSING and instance else value
    return None


def _validate_required_built_in_fields(*, project, attrs, instance):
    configuration = _merged_built_in_configuration(project.id)
    errors = {}
    for field_key, settings in configuration.items():
        if not settings.get("visible") or not settings.get("required"):
            continue
        value = _resolve_built_in_value(
            field_key=field_key,
            project=project,
            attrs=attrs,
            instance=instance,
        )
        if _is_empty(value):
            errors[field_key] = "This field is required."
    return errors


def _validate_relation_scope(*, project_id, attrs):
    errors = {}
    if "cycle_id" in attrs and attrs["cycle_id"] is not None:
        if not Cycle.objects.filter(
            id=attrs["cycle_id"],
            project_id=project_id,
            archived_at__isnull=True,
        ).exists():
            errors["cycle_id"] = "Cycle does not belong to this project."

    if "module_ids" in attrs:
        module_ids = list(attrs["module_ids"] or [])
        valid_ids = set(
            Module.objects.filter(
                id__in=module_ids,
                project_id=project_id,
                archived_at__isnull=True,
            ).values_list("id", flat=True)
        )
        invalid_ids = [str(module_id) for module_id in module_ids if module_id not in valid_ids]
        if invalid_ids:
            errors["module_ids"] = {module_id: "Module does not belong to this project." for module_id in invalid_ids}
    if errors:
        raise serializers.ValidationError(errors)


def validate_and_prepare_work_item_fields(
    *,
    project_id,
    attrs,
    instance=None,
    property_values=MISSING,
):
    project = Project.objects.get(id=project_id)
    _validate_relation_scope(project_id=project_id, attrs=attrs)
    provided = _normalize_property_input(property_values)

    properties = list(
        ProjectWorkItemProperty.objects.filter(
            project_id=project_id,
            archived_at__isnull=True,
        ).prefetch_related("options")
    )
    property_map = {str(property_instance.id): property_instance for property_instance in properties}
    unknown_ids = set(provided) - set(property_map)
    if unknown_ids:
        raise serializers.ValidationError(
            {"property_values": {property_id: "Unknown or archived property." for property_id in sorted(unknown_ids)}}
        )

    current_values = {}
    if instance:
        current_values = {
            str(value.property_id): value.value
            for value in WorkItemPropertyValue.objects.filter(
                issue=instance,
                property_id__in=property_map,
            )
        }

    normalized_values = {}
    property_errors = {}
    for property_id, property_instance in property_map.items():
        allow_archived_options = False
        if property_id in provided:
            value = provided[property_id]
        elif property_id in current_values:
            value = current_values[property_id]
            allow_archived_options = True
        else:
            value = property_instance.default_value

        try:
            normalized_value = _validate_property_value(
                property_instance,
                value,
                allow_archived_options=allow_archived_options,
                historical_value=current_values.get(property_id),
            )
        except ValueError as error:
            property_errors[property_id] = str(error)
            continue

        if property_instance.is_required and _is_empty(
            normalized_value,
            property_type=property_instance.property_type,
        ):
            property_errors[property_id] = "This property is required."
            continue
        if not _is_empty(
            normalized_value,
            property_type=property_instance.property_type,
        ):
            normalized_values[property_id] = normalized_value

    built_in_errors = _validate_required_built_in_fields(
        project=project,
        attrs=attrs,
        instance=instance,
    )
    if built_in_errors or property_errors:
        raise serializers.ValidationError(
            {
                "work_item_fields": {
                    "built_in": built_in_errors,
                    "properties": property_errors,
                }
            }
        )
    return normalized_values


@transaction.atomic
def persist_work_item_property_values(*, issue, property_values):
    active_property_ids = list(
        ProjectWorkItemProperty.objects.filter(
            project=issue.project,
            archived_at__isnull=True,
        ).values_list("id", flat=True)
    )
    normalized_values = {_canonical_id(property_id): value for property_id, value in property_values.items()}

    for property_id in active_property_ids:
        canonical_id = str(property_id)
        existing = WorkItemPropertyValue.objects.filter(
            issue=issue,
            property_id=property_id,
        ).first()
        if canonical_id not in normalized_values:
            if existing:
                existing.delete()
            continue

        if existing:
            existing.value = normalized_values[canonical_id]
            existing.save(update_fields=["value", "updated_at"])
        else:
            WorkItemPropertyValue.objects.create(
                issue=issue,
                property_id=property_id,
                project=issue.project,
                value=normalized_values[canonical_id],
            )


def serialize_work_item_property_values(issue):
    return {
        str(value.property_id): value.value
        for value in WorkItemPropertyValue.objects.filter(issue=issue).order_by("created_at")
    }


def serialize_work_item_property_values_for_issues(issue_ids):
    serialized = {str(issue_id): {} for issue_id in issue_ids}
    values = WorkItemPropertyValue.objects.filter(issue_id__in=issue_ids).values(
        "issue_id",
        "property_id",
        "value",
    )
    for value in values:
        serialized.setdefault(str(value["issue_id"]), {})[str(value["property_id"])] = value["value"]
    return serialized


@transaction.atomic
def sync_issue_cycle_and_modules(*, issue, cycle_id=MISSING, module_ids=MISSING):
    if cycle_id is not MISSING:
        cycle_issue = CycleIssue.objects.filter(issue=issue).first()
        if cycle_id is None:
            if cycle_issue:
                cycle_issue.delete()
        elif cycle_issue:
            if cycle_issue.cycle_id != cycle_id:
                cycle_issue.cycle_id = cycle_id
                cycle_issue.save(update_fields=["cycle_id", "updated_at"])
        else:
            CycleIssue.objects.create(
                issue=issue,
                cycle_id=cycle_id,
                project=issue.project,
            )

    if module_ids is not MISSING:
        requested_ids = set(module_ids or [])
        existing = {module_issue.module_id: module_issue for module_issue in ModuleIssue.objects.filter(issue=issue)}
        for module_id, module_issue in existing.items():
            if module_id not in requested_ids:
                module_issue.delete()
        ModuleIssue.objects.bulk_create(
            [
                ModuleIssue(
                    issue=issue,
                    module_id=module_id,
                    project=issue.project,
                    workspace=issue.workspace,
                )
                for module_id in requested_ids - set(existing)
            ],
            ignore_conflicts=True,
        )
