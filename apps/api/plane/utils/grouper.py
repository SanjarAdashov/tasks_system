# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date, timedelta
from uuid import UUID

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import DateField, F, Func, JSONField, Q, TextField, UUIDField, Value, QuerySet, OuterRef, Subquery
from django.db.models.functions import Cast, Coalesce, TruncMonth, TruncWeek

# Module imports
from plane.db.models import (
    Cycle,
    Issue,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
    IssueAssignee,
    ModuleIssue,
    IssueLabel,
    ProjectWorkItemProperty,
    WorkItemPropertyValue,
    WorkItemPropertyType,
)
from plane.utils.work_item_fields import serialize_work_item_property_values_for_issues
from typing import Optional, Dict, Tuple, Any, Union, List


class JsonScalarText(Func):
    template = "(%(expressions)s #>> '{}')"
    output_field = TextField()


def date_bucket_group(field):
    prefix = "datebucket_"
    if not isinstance(field, str) or not field.startswith(prefix):
        return None
    remainder = field.removeprefix(prefix)
    period, separator, source = remainder.partition("_")
    if not separator or period not in {"week", "month"}:
        return None
    if source not in {"start_date", "target_date"} and not custom_property_group_id(source):
        return None
    return period, source


def issue_queryset_grouper(
    queryset: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> QuerySet[Issue]:
    FIELD_MAPPER: Dict[str, str] = {
        "label_ids": "labels__id",
        "assignee_ids": "assignees__id",
        "module_ids": "issue_module__module_id",
    }

    GROUP_FILTER_MAPPER: Dict[str, Q] = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }

    for group_key in [group_by, sub_group_by]:
        if group_key in GROUP_FILTER_MAPPER:
            queryset = queryset.filter(GROUP_FILTER_MAPPER[group_key])

    issue_assignee_subquery = Subquery(
        IssueAssignee.objects.filter(
            issue_id=OuterRef("pk"),
            deleted_at__isnull=True,
        )
        .values("issue_id")
        .annotate(arr=ArrayAgg("assignee_id", distinct=True))
        .values("arr")
    )

    issue_module_subquery = Subquery(
        ModuleIssue.objects.filter(
            issue_id=OuterRef("pk"),
            deleted_at__isnull=True,
            module__archived_at__isnull=True,
        )
        .values("issue_id")
        .annotate(arr=ArrayAgg("module_id", distinct=True))
        .values("arr")
    )

    issue_label_subquery = Subquery(
        IssueLabel.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
        .values("issue_id")
        .annotate(arr=ArrayAgg("label_id", distinct=True))
        .values("arr")
    )

    annotations_map: Dict[str, Tuple[str, Q]] = {
        "assignee_ids": Coalesce(issue_assignee_subquery, Value([], output_field=ArrayField(UUIDField()))),
        "label_ids": Coalesce(issue_label_subquery, Value([], output_field=ArrayField(UUIDField()))),
        "module_ids": Coalesce(issue_module_subquery, Value([], output_field=ArrayField(UUIDField()))),
    }

    default_annotations: Dict[str, Any] = {}

    for key, expression in annotations_map.items():
        if FIELD_MAPPER.get(key) in {group_by, sub_group_by}:
            continue
        default_annotations[key] = expression

    for group_key in {group_by, sub_group_by}:
        bucket = date_bucket_group(group_key)
        if bucket:
            period, source = bucket
            if source in {"start_date", "target_date"}:
                date_expression = F(source)
            else:
                property_id = custom_property_group_id(source)
                json_value = Subquery(
                    WorkItemPropertyValue.objects.filter(
                        issue_id=OuterRef("pk"),
                        property_id=property_id,
                        deleted_at__isnull=True,
                    ).values("value")[:1],
                    output_field=JSONField(),
                )
                date_expression = Cast(JsonScalarText(json_value), output_field=DateField())
            default_annotations[group_key] = (
                TruncWeek(date_expression, output_field=DateField())
                if period == "week"
                else TruncMonth(date_expression, output_field=DateField())
            )
            continue
        property_id = custom_property_group_id(group_key)
        if property_id:
            default_annotations[group_key] = Subquery(
                WorkItemPropertyValue.objects.filter(
                    issue_id=OuterRef("pk"),
                    property_id=property_id,
                    deleted_at__isnull=True,
                ).values("value")[:1],
                output_field=JSONField(),
            )

    return queryset.annotate(**default_annotations)


def issue_on_results(
    issues: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> List[Dict[str, Any]]:
    FIELD_MAPPER: Dict[str, str] = {
        "labels__id": "label_ids",
        "assignees__id": "assignee_ids",
        "issue_module__module_id": "module_ids",
    }

    original_list: List[str] = ["assignee_ids", "label_ids", "module_ids"]

    required_fields: List[str] = [
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
        "sub_issues_count",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "attachment_count",
        "link_count",
        "is_draft",
        "archived_at",
        "state__group",
    ]

    if group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[group_by])
        original_list.append(group_by)

    if sub_group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[sub_group_by])
        original_list.append(sub_group_by)

    required_fields.extend(original_list)
    for group_key in {group_by, sub_group_by}:
        if custom_property_group_id(group_key) or date_bucket_group(group_key):
            required_fields.append(group_key)
    serialized_issues = list(issues.values(*required_fields))
    values_by_issue = serialize_work_item_property_values_for_issues([issue["id"] for issue in serialized_issues])
    for issue in serialized_issues:
        issue["property_values"] = values_by_issue.get(str(issue["id"]), {})
    return serialized_issues


def issue_group_values(
    field: str,
    slug: str,
    project_id: Optional[str] = None,
    filters: Dict[str, Any] = {},
    queryset: Optional[QuerySet] = None,
) -> List[Union[str, Any]]:
    bucket = date_bucket_group(field)
    if bucket:
        period, source = bucket
        values = []
        if source in {"start_date", "target_date"}:
            value_queryset = queryset
            if project_id:
                value_queryset = value_queryset.filter(project_id=project_id)
            values = list(value_queryset.values_list(source, flat=True).distinct())
        else:
            property_id = custom_property_group_id(source)
            value_queryset = WorkItemPropertyValue.objects.filter(
                property_id=property_id,
                deleted_at__isnull=True,
            )
            if queryset is not None:
                value_queryset = value_queryset.filter(issue_id__in=queryset.values("id"))
            values = list(value_queryset.values_list("value", flat=True))
        grouped_values = []
        for value in values:
            if not value:
                continue
            parsed = value if hasattr(value, "year") else date.fromisoformat(str(value))
            if period == "week":
                parsed = parsed - timedelta(days=parsed.weekday())
            else:
                parsed = parsed.replace(day=1)
            grouped_values.append(parsed.isoformat())
        return list(dict.fromkeys(grouped_values)) + ["None"]

    property_id = custom_property_group_id(field)
    if property_id:
        property_instance = ProjectWorkItemProperty.objects.filter(
            id=property_id,
            workspace__slug=slug,
            archived_at__isnull=True,
            deleted_at__isnull=True,
        )
        if project_id:
            property_instance = property_instance.filter(project_id=project_id)
        property_instance = property_instance.first()
        if not property_instance:
            return []
        value_queryset = WorkItemPropertyValue.objects.filter(
            property=property_instance,
            deleted_at__isnull=True,
        )
        if queryset is not None:
            value_queryset = value_queryset.filter(issue_id__in=queryset.values("id"))
        historical_values = list(value_queryset.values_list("value", flat=True))
        if property_instance.property_type in {
            WorkItemPropertyType.SINGLE_SELECT,
            WorkItemPropertyType.MULTI_SELECT,
        }:
            current_values = []
            if property_instance.select_source == "MEMBERS":
                current_values = list(
                    ProjectMember.objects.filter(
                        project=property_instance.project,
                        is_active=True,
                        member__is_active=True,
                        member__blocked_at__isnull=True,
                    ).values_list("member_id", flat=True)
                )
            else:
                current_values = list(
                    property_instance.options.filter(
                        archived_at__isnull=True,
                        deleted_at__isnull=True,
                    ).values_list("id", flat=True)
                )
            flattened_historical = []
            for value in historical_values:
                if isinstance(value, list):
                    flattened_historical.extend(value)
                elif value not in (None, ""):
                    flattened_historical.append(value)
            return list(dict.fromkeys([str(value) for value in current_values + flattened_historical])) + ["None"]
        if property_instance.property_type == WorkItemPropertyType.CHECKBOX:
            return [True, False, "None"]
        if property_instance.property_type == WorkItemPropertyType.DATE:
            return list(dict.fromkeys(str(value) for value in historical_values if value)) + ["None"]
        return []

    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        return list(queryset)

    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "assignees__id":
        if project_id:
            return list(
                ProjectMember.objects.filter(workspace__slug=slug, project_id=project_id, is_active=True).values_list(
                    "member_id", flat=True
                )
            )
        return list(
            WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
        )

    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "project_id":
        queryset = Project.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        return list(queryset)

    if field == "priority":
        return ["low", "medium", "high", "urgent", "none"]

    if field == "state__group":
        return ["backlog", "unstarted", "started", "completed", "cancelled"]

    if field == "target_date":
        queryset = queryset.values_list("target_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "start_date":
        queryset = queryset.values_list("start_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "created_by":
        queryset = queryset.values_list("created_by", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    return []


def custom_property_group_id(field):
    prefix = "customproperty_"
    if not isinstance(field, str) or not field.startswith(prefix):
        return None
    property_id = field.removeprefix(prefix)
    try:
        return str(UUID(property_id))
    except (TypeError, ValueError):
        return None
