# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re

# Django imports
from django.db.models import Q, TextField
from django.db.models.functions import Cast

# Module imports
from plane.db.models import ProjectWorkItemPropertyOption, User, WorkItemMultiSelectSource


def search_issues(query, queryset):
    fields = ["name", "sequence_id", "project__identifier"]
    q = Q()
    for field in fields:
        if field == "sequence_id" and len(query) <= 20:
            sequences = re.findall(r"\b\d+\b", query)
            for sequence_id in sequences:
                q |= Q(**{"sequence_id": sequence_id})
        else:
            q |= Q(**{f"{field}__icontains": query})
    matching_option_ids = [
        str(option_id)
        for option_id in ProjectWorkItemPropertyOption.objects.filter(name__icontains=query).values_list(
            "id", flat=True
        )
    ]
    queryset = queryset.annotate(custom_property_search_text=Cast("work_item_property_values__value", TextField()))
    q |= Q(custom_property_search_text__icontains=query)
    if matching_option_ids:
        q |= Q(work_item_property_values__value__in=matching_option_ids)
        for option_id in matching_option_ids:
            q |= Q(work_item_property_values__value__contains=[option_id])
    matching_member_ids = [
        str(member_id)
        for member_id in User.objects.filter(
            Q(display_name__icontains=query)
            | Q(username__icontains=query)
            | Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
        ).values_list("id", flat=True)
    ]
    for member_id in matching_member_ids:
        q |= Q(
            work_item_property_values__property__multi_select_source=WorkItemMultiSelectSource.MEMBERS,
            work_item_property_values__value__contains=[member_id],
        )
    return queryset.filter(q).distinct()
