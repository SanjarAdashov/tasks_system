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
    ensure_gts_calendar,
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


def test_caldav_zero_duration_override_does_not_make_sync_partial():
    master = """
UID:weekly-review
DTSTART:20231110T123000Z
DTEND:20231110T150000Z
RRULE:FREQ=WEEKLY;BYDAY=FR
SUMMARY:Weekly review
"""
    old_zero_duration_override = """
UID:weekly-review
RECURRENCE-ID:20241011T123000Z
DTSTART:20241011T232600Z
DTEND:20241011T232600Z
SUMMARY:Old override
"""

    events, skipped = _expand_ical_events(
        [master, old_zero_duration_override],
        calendar_id="work",
        href="/work/weekly-review.ics",
        range_start=datetime(2026, 8, 17, tzinfo=timezone.utc),
        range_end=datetime(2026, 8, 24, tzinfo=timezone.utc),
    )

    assert skipped == 0
    assert len(events) == 1
    assert events[0]["starts_at"] == datetime(2026, 8, 21, 12, 30, tzinfo=timezone.utc)


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
        is_gts_target=False,
        gts_calendar_id="",
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
        is_gts_target=False,
        gts_calendar_id="",
        selected_calendars=["https://caldav.example.test/work/"],
    )

    with pytest.raises(CalendarProviderError, match="All selected calendars failed"):
        sync_connection(
            connection,
            range_start=datetime(2026, 8, 1, tzinfo=timezone.utc),
            range_end=datetime(2026, 9, 1, tzinfo=timezone.utc),
        )

    assert manager.updates[-1]["status"] == "ERROR"


def test_gts_calendar_recovery_reuses_existing_named_calendar(monkeypatch):
    manager = _FakeCalendarConnectionManager()
    monkeypatch.setattr(external_calendar, "CalendarConnection", SimpleNamespace(objects=manager))
    monkeypatch.setattr(
        external_calendar,
        "list_provider_calendars",
        lambda connection: [
            {"id": "personal", "name": "Personal", "primary": True},
            {"id": "gts-managed", "name": "GTS Tasks System", "primary": False},
        ],
    )
    monkeypatch.setattr(
        external_calendar,
        "_create_gts_calendar",
        lambda connection: pytest.fail("an existing managed calendar must be reused"),
    )
    connection = SimpleNamespace(pk="connection-id", gts_calendar_id="deleted-gts", gts_calendar_last_error="")

    calendar_id, changed = ensure_gts_calendar(connection)

    assert calendar_id == "gts-managed"
    assert changed is True
    assert connection.gts_calendar_id == "gts-managed"
    assert manager.updates[-1] == {"gts_calendar_id": "gts-managed", "gts_calendar_last_error": ""}


def test_gts_calendar_first_setup_creates_a_dedicated_calendar(monkeypatch):
    manager = _FakeCalendarConnectionManager()
    monkeypatch.setattr(external_calendar, "CalendarConnection", SimpleNamespace(objects=manager))
    monkeypatch.setattr(
        external_calendar,
        "list_provider_calendars",
        lambda connection: [
            {"id": "same-name-user-calendar", "name": "GTS Tasks System", "primary": False},
        ],
    )
    monkeypatch.setattr(external_calendar, "_create_gts_calendar", lambda connection: "new-managed-calendar")
    connection = SimpleNamespace(pk="connection-id", gts_calendar_id="", gts_calendar_last_error="")

    calendar_id, changed = ensure_gts_calendar(connection)

    assert calendar_id == "new-managed-calendar"
    assert changed is True


@pytest.mark.parametrize(
    ("provider", "expected_url", "response_payload", "expected_body"),
    [
        (
            "GOOGLE",
            "https://www.googleapis.com/calendar/v3/calendars",
            {"id": "google-gts-calendar"},
            {"summary": "GTS Tasks System", "description": "Meetings managed by GTS Tasks System."},
        ),
        (
            "MICROSOFT",
            "https://graph.microsoft.com/v1.0/me/calendars",
            {"id": "microsoft-gts-calendar"},
            {"name": "GTS Tasks System"},
        ),
    ],
)
def test_google_and_microsoft_create_a_separate_gts_calendar(
    monkeypatch,
    provider,
    expected_url,
    response_payload,
    expected_body,
):
    requests = []

    def authorized_request(connection, method, url, **kwargs):
        requests.append((method, url, kwargs))
        return SimpleNamespace(ok=True, json=lambda: response_payload)

    monkeypatch.setattr(external_calendar, "_authorized_request", authorized_request)
    connection = SimpleNamespace(provider=provider)

    calendar_id = external_calendar._create_gts_calendar(connection)

    assert calendar_id == response_payload["id"]
    assert requests == [("POST", expected_url, {"json": expected_body})]


def test_caldav_creates_a_separate_gts_calendar_collection(monkeypatch):
    captured = {}

    def request(method, url, **kwargs):
        captured.update({"method": method, "url": url, **kwargs})
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(external_calendar, "_json_credentials", lambda connection: {"username": "user"})
    monkeypatch.setattr(external_calendar, "_server_url", lambda connection: "https://caldav.example.test/")
    monkeypatch.setattr(
        external_calendar,
        "_caldav_home_url",
        lambda **kwargs: "https://caldav.example.test/home/",
    )
    monkeypatch.setattr(external_calendar.requests, "request", request)
    connection = SimpleNamespace(provider="ICLOUD")

    calendar_id = external_calendar._create_gts_calendar(connection)

    assert captured["method"] == "MKCALENDAR"
    assert captured["url"] == calendar_id
    assert calendar_id.startswith("https://caldav.example.test/home/gts-tasks-system-")
    assert b"<d:displayname>GTS Tasks System</d:displayname>" in captured["data"]


def test_caldav_calendar_creation_failure_is_explicit(monkeypatch):
    monkeypatch.setattr(external_calendar, "_json_credentials", lambda connection: {"username": "user"})
    monkeypatch.setattr(external_calendar, "_server_url", lambda connection: "https://caldav.example.test/")
    monkeypatch.setattr(
        external_calendar,
        "_caldav_home_url",
        lambda **kwargs: "https://caldav.example.test/home/",
    )
    monkeypatch.setattr(
        external_calendar.requests,
        "request",
        lambda *args, **kwargs: SimpleNamespace(status_code=403),
    )

    with pytest.raises(CalendarProviderError, match="could not create a separate"):
        external_calendar._create_gts_calendar(SimpleNamespace(provider="CALDAV"))
