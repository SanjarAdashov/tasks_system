from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

# ruff: noqa: E501 -- inline CalDAV fixtures are easier to audit as complete XML responses

from plane.utils import external_calendar
from plane.utils.external_calendar import (
    CalendarProviderError,
    _discover_caldav_calendars,
    _expand_ical_events,
    _microsoft_recurrence,
    sync_connection,
)


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


def test_caldav_discovery_excludes_home_and_scheduling_collections(monkeypatch):
    discovery = external_calendar.ElementTree.fromstring(
        """<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>
        </d:multistatus>"""
    )
    listing = external_calendar.ElementTree.fromstring(
        """<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response><d:href>/home/</d:href><d:propstat><d:prop><d:displayname>Account</d:displayname><d:resourcetype><d:collection/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
          <d:response><d:href>/home/inbox/</d:href><d:propstat><d:prop><d:displayname>Inbox</d:displayname><d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
          <d:response><d:href>/home/outbox/</d:href><d:propstat><d:prop><d:displayname>Outbox</d:displayname><d:resourcetype><d:collection/><c:schedule-outbox/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
          <d:response><d:href>/home/work/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
          <d:response><d:href>/home/tasks/</d:href><d:propstat><d:prop><d:displayname>Tasks</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
        </d:multistatus>"""
    )
    responses = iter([discovery, listing])
    monkeypatch.setattr(external_calendar, "_caldav_propfind", lambda *args, **kwargs: next(responses))

    calendars = _discover_caldav_calendars(
        server_url="https://caldav.example.test/",
        credentials={"username": "user", "app_password": "password"},
    )

    assert calendars == [{"id": "https://caldav.example.test/home/work/", "name": "Work", "primary": True}]


def test_caldav_recurrence_expands_tzid_exdate_and_override():
    master = """
UID:flight-review
DTSTART;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260820T090000
DTEND;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260820T100000
RRULE:FREQ=DAILY;COUNT=3
EXDATE;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260821T090000
SUMMARY:Flight review
"""
    override = """
UID:flight-review
RECURRENCE-ID;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260822T090000
DTSTART;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260822T120000
DTEND;TZID=/freeassociation.sourceforge.net/Tzfile/Asia/Tashkent:20260822T130000
SUMMARY:Moved flight review
"""

    events, skipped = _expand_ical_events(
        [master, override],
        calendar_id="work",
        href="/work/flight-review.ics",
        range_start=datetime(2026, 8, 19, tzinfo=timezone.utc),
        range_end=datetime(2026, 8, 24, tzinfo=timezone.utc),
    )

    assert skipped == 0
    assert [(item["title"], item["starts_at"].astimezone(timezone.utc)) for item in events] == [
        ("Flight review", datetime(2026, 8, 20, 4, tzinfo=timezone.utc)),
        ("Moved flight review", datetime(2026, 8, 22, 7, tzinfo=timezone.utc)),
    ]


class _FakeCalendarConnectionManager:
    def __init__(self):
        self.updates = []

    def filter(self, **kwargs):
        self.filter_kwargs = kwargs
        return self

    def update(self, **kwargs):
        self.updates.append(kwargs)


def test_caldav_sync_sanitizes_sources_and_keeps_partial_results(monkeypatch):
    manager = _FakeCalendarConnectionManager()
    monkeypatch.setattr(external_calendar, "CalendarConnection", SimpleNamespace(objects=manager))
    monkeypatch.setattr(
        external_calendar,
        "discover_caldav_calendars",
        lambda connection: [
            {"id": "https://caldav.example.test/work/", "primary": True},
            {"id": "https://caldav.example.test/home/", "primary": False},
        ],
    )
    monkeypatch.setattr(
        external_calendar,
        "pull_caldav",
        lambda *args, **kwargs: {
            "events": 12,
            "successful_sources": 1,
            "failures": [{"calendar_id": "home", "reason": "HTTP 403"}],
            "skipped_events": 0,
        },
    )
    connection = SimpleNamespace(
        pk="connection-id",
        provider="ICLOUD",
        sync_mode="FULL",
        selected_calendars=[
            "https://caldav.example.test/account/",
            "https://caldav.example.test/work/",
        ],
    )

    count = sync_connection(
        connection,
        range_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
        range_end=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )

    assert count == 12
    assert connection.selected_calendars == ["https://caldav.example.test/work/"]
    assert manager.updates[-1]["status"] == "PARTIAL"
    assert "HTTP 403" in manager.updates[-1]["last_error"]


def test_caldav_sync_marks_error_only_when_every_source_fails(monkeypatch):
    manager = _FakeCalendarConnectionManager()
    monkeypatch.setattr(external_calendar, "CalendarConnection", SimpleNamespace(objects=manager))
    monkeypatch.setattr(
        external_calendar,
        "discover_caldav_calendars",
        lambda connection: [{"id": "https://caldav.example.test/work/", "primary": True}],
    )
    monkeypatch.setattr(
        external_calendar,
        "pull_caldav",
        lambda *args, **kwargs: {
            "events": 0,
            "successful_sources": 0,
            "failures": [{"calendar_id": "work", "reason": "HTTP 503"}],
            "skipped_events": 0,
        },
    )
    connection = SimpleNamespace(
        pk="connection-id",
        provider="ICLOUD",
        sync_mode="FULL",
        selected_calendars=["https://caldav.example.test/work/"],
    )

    with pytest.raises(CalendarProviderError, match="All selected calendars failed"):
        sync_connection(
            connection,
            range_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
            range_end=datetime(2026, 9, 1, tzinfo=timezone.utc),
        )

    assert manager.updates[-1]["status"] == "ERROR"
