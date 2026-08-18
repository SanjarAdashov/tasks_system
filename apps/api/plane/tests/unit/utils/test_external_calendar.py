from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from plane.utils.external_calendar import CalendarProviderError, _microsoft_recurrence


def meeting(rule):
    return SimpleNamespace(
        recurrence_rule=rule,
        starts_at=datetime(2026, 8, 17, 5, 0, tzinfo=timezone.utc),
    )


def test_microsoft_weekly_recurrence_uses_rfc_days_and_count():
    result = _microsoft_recurrence(meeting("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5"))

    assert result == {
        "pattern": {
            "type": "weekly",
            "interval": 2,
            "daysOfWeek": ["monday", "wednesday"],
            "firstDayOfWeek": "monday",
        },
        "range": {
            "type": "numbered",
            "startDate": "2026-08-17",
            "numberOfOccurrences": 5,
        },
    }


def test_microsoft_yearly_recurrence_uses_until_date():
    result = _microsoft_recurrence(meeting("RRULE:FREQ=YEARLY;UNTIL=20290817T185959Z"))

    assert result["pattern"] == {
        "type": "absoluteYearly",
        "interval": 1,
        "month": 8,
        "dayOfMonth": 17,
    }
    assert result["range"] == {
        "type": "endDate",
        "startDate": "2026-08-17",
        "endDate": "2029-08-17",
    }


def test_microsoft_recurrence_rejects_unsupported_frequency():
    with pytest.raises(CalendarProviderError):
        _microsoft_recurrence(meeting("RRULE:FREQ=HOURLY"))
