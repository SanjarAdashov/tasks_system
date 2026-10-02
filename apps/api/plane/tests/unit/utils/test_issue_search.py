# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from unittest.mock import Mock, patch

import pytest
from django.db.models import Q

from plane.utils.issue_search import search_issues


def query_lookups(query):
    for child in query.children:
        if isinstance(child, Q):
            yield from query_lookups(child)
        else:
            yield child


@pytest.mark.unit
@pytest.mark.parametrize("include_description", [False, True])
def test_search_description_is_an_optional_or_condition(include_description):
    queryset = Mock()
    queryset.annotate.return_value = queryset
    queryset.filter.return_value = queryset
    queryset.distinct.return_value = queryset

    with (
        patch("plane.utils.issue_search.ProjectWorkItemPropertyOption.objects.filter") as options,
        patch("plane.utils.issue_search.User.objects.filter") as members,
    ):
        options.return_value.values_list.return_value = []
        members.return_value.values_list.return_value = []
        result = search_issues("atlanta", queryset, include_description=include_description)

    query = queryset.filter.call_args.args[0]
    lookups = dict(query_lookups(query))
    assert query.connector == Q.OR
    assert lookups["name__icontains"] == "atlanta"
    assert ("description_stripped__icontains" in lookups) is include_description
    assert result is queryset
    queryset.distinct.assert_called_once_with()


@pytest.mark.unit
def test_search_description_default_is_disabled():
    queryset = Mock()
    queryset.annotate.return_value = queryset
    with (
        patch("plane.utils.issue_search.ProjectWorkItemPropertyOption.objects.filter") as options,
        patch("plane.utils.issue_search.User.objects.filter") as members,
    ):
        options.return_value.values_list.return_value = []
        members.return_value.values_list.return_value = []
        search_issues("atlanta", queryset)

    assert "description_stripped__icontains" not in dict(query_lookups(queryset.filter.call_args.args[0]))
