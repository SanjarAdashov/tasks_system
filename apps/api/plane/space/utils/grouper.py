# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, F, Case, When, JSONField, CharField, OuterRef, Subquery
from django.db.models.functions import Cast, Coalesce, JSONObject, Concat
from django.db.models import QuerySet

from typing import List, Optional, Dict, Any, Union

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
    ProjectWorkItemProperty,
    WorkItemPropertyValue,
    WorkItemPropertyType,
)
from plane.utils.work_item_fields import serialize_work_item_property_values_for_issues


def issue_queryset_grouper(
    queryset: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> QuerySet[Issue]:
    FIELD_MAPPER = {
        "label_ids": "labels__id",
        "assignee_ids": "assignees__id",
        "module_ids": "issue_module__module_id",
    }

    GROUP_FILTER_MAPPER = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }

    for group_key in [group_by, sub_group_by]:
        if group_key in GROUP_FILTER_MAPPER:
            queryset = queryset.filter(GROUP_FILTER_MAPPER[group_key])

    annotations_map = {
        "assignee_ids": (
            "assignees__id",
            ~Q(assignees__id__isnull=True) & Q(issue_assignee__deleted_at__isnull=True),
        ),
        "label_ids": (
            "labels__id",
            ~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True),
        ),
        "module_ids": (
            "issue_module__module_id",
            ~Q(issue_module__module_id__isnull=True),
        ),
    }
    default_annotations = {
        key: Coalesce(
            ArrayAgg(field, distinct=True, filter=condition),
            Value([], output_field=ArrayField(UUIDField())),
        )
        for key, (field, condition) in annotations_map.items()
        if FIELD_MAPPER.get(key) != group_by or FIELD_MAPPER.get(key) != sub_group_by
    }

    for group_key in {group_by, sub_group_by}:
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
    issues: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> List[Dict[str, Any]]:
    FIELD_MAPPER = {
        "labels__id": "label_ids",
        "assignees__id": "assignee_ids",
        "issue_module__module_id": "module_ids",
    }

    original_list = ["assignee_ids", "label_ids", "module_ids"]

    required_fields = [
        "id",
        "name",
        "state_id",
        "sort_order",
        "estimate_point",
        "priority",
        "start_date",
        "target_date",
        "sequence_id",
        "project_id",
        "parent_id",
        "cycle_id",
        "created_by",
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
        if custom_property_group_id(group_key):
            required_fields.append(group_key)

    serialized_issues = list(
        issues.annotate(
            vote_items=ArrayAgg(
                Case(
                    When(
                        votes__isnull=False,
                        votes__deleted_at__isnull=True,
                        then=JSONObject(
                            vote=F("votes__vote"),
                            actor_details=JSONObject(
                                id=F("votes__actor__id"),
                                first_name=F("votes__actor__first_name"),
                                last_name=F("votes__actor__last_name"),
                                avatar=F("votes__actor__avatar"),
                                avatar_url=Case(
                                    When(
                                        votes__actor__avatar_asset__isnull=False,
                                        then=Concat(
                                            Value("/api/assets/v2/static/"),
                                            Cast("votes__actor__avatar_asset", CharField()),
                                            Value("/"),
                                        ),
                                    ),
                                    default=F("votes__actor__avatar"),
                                    output_field=CharField(),
                                ),
                                display_name=F("votes__actor__display_name"),
                            ),
                        ),
                    ),
                    default=None,
                    output_field=JSONField(),
                ),
                filter=Q(votes__isnull=False, votes__deleted_at__isnull=True),
                distinct=True,
            ),
            reaction_items=ArrayAgg(
                Case(
                    When(
                        issue_reactions__isnull=False,
                        issue_reactions__deleted_at__isnull=True,
                        then=JSONObject(
                            reaction=F("issue_reactions__reaction"),
                            actor_details=JSONObject(
                                id=F("issue_reactions__actor__id"),
                                first_name=F("issue_reactions__actor__first_name"),
                                last_name=F("issue_reactions__actor__last_name"),
                                avatar=F("issue_reactions__actor__avatar"),
                                avatar_url=Case(
                                    When(
                                        issue_reactions__actor__avatar_asset__isnull=False,
                                        then=Concat(
                                            Value("/api/assets/v2/static/"),
                                            Cast("issue_reactions__actor__avatar_asset", CharField()),
                                            Value("/"),
                                        ),
                                    ),
                                    default=F("issue_reactions__actor__avatar"),
                                    output_field=CharField(),
                                ),
                                display_name=F("issue_reactions__actor__display_name"),
                            ),
                        ),
                    ),
                    default=None,
                    output_field=JSONField(),
                ),
                filter=Q(issue_reactions__isnull=False, issue_reactions__deleted_at__isnull=True),
                distinct=True,
            ),
        ).values(*required_fields, "vote_items", "reaction_items")
    )

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
        if property_instance.property_type == WorkItemPropertyType.SINGLE_SELECT:
            return list(
                property_instance.options.filter(
                    archived_at__isnull=True,
                    deleted_at__isnull=True,
                ).values_list("id", flat=True)
            ) + ["None"]
        if property_instance.property_type == WorkItemPropertyType.CHECKBOX:
            return [True, False, "None"]
        return []

    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)
    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "assignees__id":
        if project_id:
            return ProjectMember.objects.filter(
                workspace__slug=slug, project_id=project_id, is_active=True
            ).values_list("member_id", flat=True)
        else:
            return list(
                WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
            )
    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
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
