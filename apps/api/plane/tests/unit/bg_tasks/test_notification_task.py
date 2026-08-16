# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace

import pytest

from plane.bgtasks.notification_task import _should_send_issue_activity_email


def _preference(**overrides):
    values = {
        "property_change": False,
        "state_change": False,
        "comment": False,
        "mention": False,
        "issue_completed": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("field", "preference_values", "is_completed_state", "expected"),
    [
        ("priority", {"property_change": True}, False, True),
        ("priority", {}, False, False),
        ("state", {"property_change": True}, False, False),
        ("state", {"state_change": True}, False, True),
        ("state", {"issue_completed": True}, False, False),
        ("state", {"issue_completed": True}, True, True),
        ("comment", {"property_change": True}, False, False),
        ("comment", {"comment": True}, False, True),
        ("mention", {"property_change": True}, False, False),
        ("mention", {"mention": True}, False, True),
        ("description", {"property_change": True}, False, False),
    ],
)
def test_issue_activity_uses_only_its_email_preference(
    field,
    preference_values,
    is_completed_state,
    expected,
):
    assert (
        _should_send_issue_activity_email(
            field=field,
            preference=_preference(**preference_values),
            is_completed_state=is_completed_state,
        )
        is expected
    )
