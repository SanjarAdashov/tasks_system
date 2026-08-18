# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Provider adapters for user-owned external calendars.

GTS remains the canonical store. Provider credentials are encrypted at rest and
only decrypted inside the worker/API process. External events that were not
created by GTS are mirrored into ``MeetingExternalEvent`` for calendar display
and availability calculations.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib.parse import quote, urlencode, urljoin, urlparse
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

# ruff: noqa: E501 -- provider payload dictionaries are clearer when kept on one line

import requests
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from plane.db.models import (
    CalendarConnection,
    CalendarConnectionStatus,
    CalendarProvider,
    CalendarSyncMode,
    Meeting,
    MeetingAvailability,
    MeetingExternalEvent,
    MeetingRecurrenceException,
    MeetingStatus,
)
from plane.license.utils.encryption import decrypt_data, encrypt_data
from plane.license.utils.instance_value import get_calendar_configuration


HTTP_TIMEOUT = (10, 45)
OAUTH_STATE_SALT = "gts-calendar-oauth-v1"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
]
GOOGLE_MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.created"
MICROSOFT_SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"]
MICROSOFT_GTS_MEETING_PROPERTY = "String {6AAB53A7-524C-4E27-BB2A-7206AAFA8E0D} Name gtsMeetingId"


class CalendarProviderError(RuntimeError):
    pass


def _json_credentials(connection):
    if not connection.credentials_encrypted:
        return {}
    try:
        return json.loads(decrypt_data(connection.credentials_encrypted))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise CalendarProviderError("Stored calendar credentials are invalid.") from exc


def _save_credentials(connection, payload):
    connection.credentials_encrypted = encrypt_data(json.dumps(payload))
    connection.save(update_fields=["credentials_encrypted", "updated_at"])


def _server_url(connection):
    return decrypt_data(connection.server_url_encrypted) if connection.server_url_encrypted else ""


def oauth_configuration(provider):
    config = get_calendar_configuration()
    if provider == CalendarProvider.GOOGLE:
        client_id = config["CALENDAR_GOOGLE_CLIENT_ID"]
        client_secret = config["CALENDAR_GOOGLE_CLIENT_SECRET"]
    elif provider == CalendarProvider.MICROSOFT:
        client_id = config["CALENDAR_MICROSOFT_CLIENT_ID"]
        client_secret = config["CALENDAR_MICROSOFT_CLIENT_SECRET"]
    else:
        raise CalendarProviderError("This provider does not use OAuth.")
    if not client_id or not client_secret:
        raise CalendarProviderError("Calendar OAuth is not configured by the instance administrator.")
    return config, client_id, client_secret


def build_oauth_authorization_url(*, provider, user_id, redirect_uri, return_url, purpose="personal_calendar"):
    config, client_id, _ = oauth_configuration(provider)
    state = signing.dumps(
        {
            "provider": provider,
            "user_id": str(user_id),
            "return_url": return_url,
            "nonce": uuid.uuid4().hex,
            "purpose": purpose,
        },
        salt=OAUTH_STATE_SALT,
        compress=True,
    )
    if provider == CalendarProvider.GOOGLE:
        endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES + ([GOOGLE_MEET_SCOPE] if purpose == "system_meet" else [])),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
    else:
        tenant = config["CALENDAR_MICROSOFT_TENANT"] or "common"
        endpoint = f"https://login.microsoftonline.com/{quote(tenant)}/oauth2/v2.0/authorize"
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(MICROSOFT_SCOPES),
            "response_mode": "query",
            "state": state,
        }
    return f"{endpoint}?{urlencode(params)}"


def read_oauth_state(value, *, max_age=900):
    try:
        return signing.loads(value, salt=OAUTH_STATE_SALT, max_age=max_age)
    except signing.BadSignature as exc:
        raise CalendarProviderError("OAuth state is invalid or expired.") from exc


def exchange_oauth_code(*, provider, code, redirect_uri):
    config, client_id, client_secret = oauth_configuration(provider)
    if provider == CalendarProvider.GOOGLE:
        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    else:
        tenant = config["CALENDAR_MICROSOFT_TENANT"] or "common"
        token_url = f"https://login.microsoftonline.com/{quote(tenant)}/oauth2/v2.0/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "scope": " ".join(MICROSOFT_SCOPES),
        }
    response = requests.post(token_url, data=data, timeout=HTTP_TIMEOUT)
    if not response.ok:
        raise CalendarProviderError("The calendar provider rejected the OAuth code.")
    payload = response.json()
    payload["expires_at"] = (timezone.now() + timedelta(seconds=int(payload.get("expires_in", 3600)))).isoformat()
    return payload


def _authorized_request(connection, method, url, **kwargs):
    credentials = _json_credentials(connection)
    expires_at = parse_datetime(credentials.get("expires_at", ""))
    if expires_at is None or expires_at <= timezone.now() + timedelta(minutes=2):
        credentials = refresh_oauth_token(connection, credentials)
    headers = dict(kwargs.pop("headers", {}))
    headers["Authorization"] = f"Bearer {credentials['access_token']}"
    response = requests.request(method, url, headers=headers, timeout=HTTP_TIMEOUT, **kwargs)
    if response.status_code == 401:
        credentials = refresh_oauth_token(connection, credentials, force=True)
        headers["Authorization"] = f"Bearer {credentials['access_token']}"
        response = requests.request(method, url, headers=headers, timeout=HTTP_TIMEOUT, **kwargs)
    return response


def refresh_oauth_token(connection, credentials=None, *, force=False):
    credentials = credentials or _json_credentials(connection)
    refresh_token = credentials.get("refresh_token")
    if not refresh_token:
        raise CalendarProviderError("Reconnect this account to renew calendar access.")
    config, client_id, client_secret = oauth_configuration(connection.provider)
    if connection.provider == CalendarProvider.GOOGLE:
        url = "https://oauth2.googleapis.com/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    else:
        tenant = config["CALENDAR_MICROSOFT_TENANT"] or "common"
        url = f"https://login.microsoftonline.com/{quote(tenant)}/oauth2/v2.0/token"
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
            "scope": " ".join(MICROSOFT_SCOPES),
        }
    response = requests.post(url, data=data, timeout=HTTP_TIMEOUT)
    if not response.ok:
        raise CalendarProviderError("Calendar authorization expired. Reconnect the account.")
    fresh = response.json()
    credentials.update(fresh)
    credentials["refresh_token"] = fresh.get("refresh_token") or refresh_token
    credentials["expires_at"] = (timezone.now() + timedelta(seconds=int(fresh.get("expires_in", 3600)))).isoformat()
    _save_credentials(connection, credentials)
    return credentials


def oauth_account_profile(provider, token_payload):
    headers = {"Authorization": f"Bearer {token_payload['access_token']}"}
    if provider == CalendarProvider.GOOGLE:
        response = requests.get(
            "https://openidconnect.googleapis.com/v1/userinfo", headers=headers, timeout=HTTP_TIMEOUT
        )
        data = response.json() if response.ok else {}
        return data.get("email", ""), data.get("name", "")
    response = requests.get("https://graph.microsoft.com/v1.0/me", headers=headers, timeout=HTTP_TIMEOUT)
    data = response.json() if response.ok else {}
    return data.get("mail") or data.get("userPrincipalName", ""), data.get("displayName", "")


def _caldav_propfind(url, *, credentials, body, depth="0"):
    response = requests.request(
        "PROPFIND",
        url,
        headers={"Depth": depth, "Content-Type": "application/xml; charset=utf-8"},
        data=body.encode(),
        auth=(credentials.get("username", ""), credentials.get("app_password", "")),
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code not in (200, 207):
        raise CalendarProviderError(f"CalDAV server returned HTTP {response.status_code} during discovery.")
    return ElementTree.fromstring(response.content)


def discover_caldav_calendars(connection):
    """Resolve a CalDAV account root (including iCloud) to VEVENT collections."""
    credentials = _json_credentials(connection)
    server_url = _server_url(connection)
    discovery_body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:displayname/><d:resourcetype/></d:prop>
</d:propfind>"""
    root = _caldav_propfind(server_url, credentials=credentials, body=discovery_body)
    principal = root.findtext(".//{DAV:}current-user-principal/{DAV:}href")
    home = root.findtext(".//{urn:ietf:params:xml:ns:caldav}calendar-home-set/{DAV:}href")
    if not home and principal:
        principal_url = urljoin(server_url, principal)
        principal_root = _caldav_propfind(principal_url, credentials=credentials, body=discovery_body)
        home = principal_root.findtext(".//{urn:ietf:params:xml:ns:caldav}calendar-home-set/{DAV:}href")
    home_url = urljoin(server_url, home) if home else server_url
    list_body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>
</d:propfind>"""
    list_root = _caldav_propfind(home_url, credentials=credentials, body=list_body, depth="1")
    calendars = []
    for node in list_root.findall("{DAV:}response"):
        href = node.findtext("{DAV:}href") or ""
        resource_type = node.find(".//{DAV:}resourcetype")
        has_calendar_type = (
            resource_type is not None and resource_type.find("{urn:ietf:params:xml:ns:caldav}calendar") is not None
        )
        components = node.findall(
            ".//{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set/{urn:ietf:params:xml:ns:caldav}comp"
        )
        has_events = any((item.attrib.get("name") or "").upper() == "VEVENT" for item in components)
        if not has_calendar_type and not has_events:
            continue
        calendar_url = urljoin(home_url, href)
        name = node.findtext(".//{DAV:}displayname") or calendar_url.rstrip("/").rsplit("/", 1)[-1]
        calendars.append({"id": calendar_url, "name": name, "primary": not calendars})
    if not calendars:
        calendars.append(
            {
                "id": server_url,
                "name": connection.account_label or connection.account_email or "Calendar",
                "primary": True,
            }
        )
    return calendars


def list_provider_calendars(connection):
    if connection.provider == CalendarProvider.GOOGLE:
        response = _authorized_request(
            connection,
            "GET",
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            params={"maxResults": 250},
        )
        if not response.ok:
            raise CalendarProviderError(f"Google Calendar returned HTTP {response.status_code}.")
        return [
            {
                "id": item["id"],
                "name": item.get("summaryOverride") or item.get("summary") or item["id"],
                "primary": bool(item.get("primary")),
            }
            for item in response.json().get("items", [])
        ]
    if connection.provider == CalendarProvider.MICROSOFT:
        response = _authorized_request(
            connection,
            "GET",
            "https://graph.microsoft.com/v1.0/me/calendars",
            params={"$top": 250, "$select": "id,name,isDefaultCalendar"},
        )
        if not response.ok:
            raise CalendarProviderError(f"Microsoft Calendar returned HTTP {response.status_code}.")
        return [
            {
                "id": item["id"],
                "name": item.get("name") or item["id"],
                "primary": bool(item.get("isDefaultCalendar")),
            }
            for item in response.json().get("value", [])
        ]
    return discover_caldav_calendars(connection)


def save_oauth_connection(*, user, provider, token_payload):
    email, label = oauth_account_profile(provider, token_payload)
    if not email:
        raise CalendarProviderError("The provider did not return an account email.")
    connection, _ = CalendarConnection.objects.get_or_create(
        user=user,
        provider=provider,
        account_email=email.lower(),
        defaults={"account_label": label or email},
    )
    connection.account_label = label or connection.account_label or email
    connection.status = CalendarConnectionStatus.CONNECTED
    connection.credentials_encrypted = encrypt_data(json.dumps(token_payload))
    connection.last_error = ""
    connection.last_error_at = None
    connection.save()
    return connection


def _provider_datetime(value, *, all_day=False):
    if not value:
        return None
    if all_day and len(value) == 10:
        return datetime.fromisoformat(value).replace(tzinfo=dt_timezone.utc)
    parsed = parse_datetime(value)
    if parsed and timezone.is_naive(parsed):
        parsed = parsed.replace(tzinfo=dt_timezone.utc)
    return parsed


def _upsert_event(connection, event):
    starts_at = event.get("starts_at")
    ends_at = event.get("ends_at")
    if not starts_at or not ends_at or ends_at <= starts_at:
        return None
    linked_meeting = None
    if event.get("meeting_id"):
        linked_meeting = (
            Meeting.objects.filter(id=event["meeting_id"])
            .filter(
                Q(organizer_id=connection.user_id)
                | Q(participants__user_id=connection.user_id, participants__removed_at__isnull=True)
            )
            .distinct()
            .first()
        )
    defaults = {
        "title": event.get("title", "")[:255],
        "starts_at": starts_at,
        "ends_at": ends_at,
        "all_day": bool(event.get("all_day")),
        "availability": event.get("availability", MeetingAvailability.BUSY),
        "provider_updated_at": event.get("provider_updated_at"),
        "etag": event.get("etag", "")[:512],
        "raw_payload_encrypted": encrypt_data(json.dumps(event.get("raw_payload") or {})),
        "is_deleted_at_provider": bool(event.get("deleted")),
    }
    if linked_meeting is not None:
        defaults["meeting"] = linked_meeting
    row, _ = MeetingExternalEvent.objects.update_or_create(
        connection=connection,
        provider_calendar_id=event.get("calendar_id", "")[:512],
        provider_event_id=event["id"][:512],
        defaults=defaults,
    )
    if (
        row.meeting_id
        and event.get("is_recurring_instance")
        and defaults["is_deleted_at_provider"]
        and event.get("original_starts_at")
    ):
        MeetingRecurrenceException.objects.update_or_create(
            meeting_id=row.meeting_id,
            original_starts_at=event["original_starts_at"].replace(microsecond=0),
            defaults={"action": MeetingRecurrenceException.Action.CANCELLED, "overrides": {}},
        )
    if (
        row.meeting_id
        and not event.get("is_recurring_instance")
        and connection.user_id == row.meeting.organizer_id
        and connection.sync_mode == CalendarSyncMode.FULL
    ):
        provider_updated_at = defaults["provider_updated_at"]
        if defaults["is_deleted_at_provider"]:
            Meeting.objects.filter(pk=row.meeting_id).exclude(status=MeetingStatus.CANCELLED).update(
                status=MeetingStatus.CANCELLED,
                cancelled_at=timezone.now(),
            )
        elif provider_updated_at and provider_updated_at > row.meeting.updated_at:
            Meeting.objects.filter(pk=row.meeting_id).update(
                title=defaults["title"] or row.meeting.title,
                starts_at=starts_at,
                ends_at=ends_at,
                all_day=defaults["all_day"],
            )
    return row


def pull_google(connection, *, range_start, range_end):
    calendar_ids = connection.selected_calendars or ["primary"]
    count = 0
    for calendar_id in calendar_ids:
        page_token = None
        while True:
            params = {
                "timeMin": range_start.astimezone(dt_timezone.utc).isoformat(),
                "timeMax": range_end.astimezone(dt_timezone.utc).isoformat(),
                "singleEvents": "true",
                "showDeleted": "true",
                "maxResults": 2500,
            }
            if page_token:
                params["pageToken"] = page_token
            response = _authorized_request(
                connection,
                "GET",
                f"https://www.googleapis.com/calendar/v3/calendars/{quote(str(calendar_id), safe='')}/events",
                params=params,
            )
            if not response.ok:
                raise CalendarProviderError(f"Google Calendar returned HTTP {response.status_code}.")
            payload = response.json()
            for item in payload.get("items", []):
                all_day = "date" in item.get("start", {})
                starts_at = _provider_datetime(
                    item.get("start", {}).get("dateTime") or item.get("start", {}).get("date"), all_day=all_day
                )
                ends_at = _provider_datetime(
                    item.get("end", {}).get("dateTime") or item.get("end", {}).get("date"), all_day=all_day
                )
                updated = _provider_datetime(item.get("updated"))
                original_start = item.get("originalStartTime", {})
                _upsert_event(
                    connection,
                    {
                        "id": item["id"],
                        "calendar_id": str(calendar_id),
                        "title": item.get("summary") or "",
                        "starts_at": starts_at,
                        "ends_at": ends_at,
                        "all_day": all_day,
                        "availability": MeetingAvailability.FREE
                        if item.get("transparency") == "transparent"
                        else MeetingAvailability.BUSY,
                        "provider_updated_at": updated,
                        "etag": item.get("etag", ""),
                        "deleted": item.get("status") == "cancelled",
                        "is_recurring_instance": bool(item.get("recurringEventId")),
                        "original_starts_at": _provider_datetime(
                            original_start.get("dateTime") or original_start.get("date"),
                            all_day="date" in original_start,
                        ),
                        "meeting_id": (item.get("extendedProperties", {}).get("private", {}) or {}).get("gtsMeetingId"),
                        "raw_payload": item,
                    },
                )
                count += 1
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
    return count


def pull_microsoft(connection, *, range_start, range_end):
    count = 0
    calendar_ids = connection.selected_calendars or ["primary"]
    for calendar_id in calendar_ids:
        params = {
            "startDateTime": range_start.astimezone(dt_timezone.utc).isoformat(),
            "endDateTime": range_end.astimezone(dt_timezone.utc).isoformat(),
            "$top": 500,
            "$select": "id,subject,start,end,isAllDay,showAs,lastModifiedDateTime,type,seriesMasterId,@odata.etag",
            "$expand": f"singleValueExtendedProperties($filter=id eq '{MICROSOFT_GTS_MEETING_PROPERTY}')",
        }
        url = (
            "https://graph.microsoft.com/v1.0/me/calendarView"
            if calendar_id == "primary"
            else f"https://graph.microsoft.com/v1.0/me/calendars/{quote(str(calendar_id), safe='')}/calendarView"
        )
        first_page = True
        while url:
            response = _authorized_request(connection, "GET", url, params=params if first_page else None)
            if not response.ok:
                raise CalendarProviderError(f"Microsoft Calendar returned HTTP {response.status_code}.")
            payload = response.json()
            for item in payload.get("value", []):
                starts_at = _provider_datetime(item.get("start", {}).get("dateTime"))
                ends_at = _provider_datetime(item.get("end", {}).get("dateTime"))
                _upsert_event(
                    connection,
                    {
                        "id": item["id"],
                        "calendar_id": str(calendar_id),
                        "title": item.get("subject") or "",
                        "starts_at": starts_at,
                        "ends_at": ends_at,
                        "all_day": item.get("isAllDay", False),
                        "availability": MeetingAvailability.FREE
                        if item.get("showAs") == "free"
                        else MeetingAvailability.BUSY,
                        "provider_updated_at": _provider_datetime(item.get("lastModifiedDateTime")),
                        "etag": item.get("@odata.etag", ""),
                        "is_recurring_instance": bool(item.get("seriesMasterId")),
                        "meeting_id": next(
                            (
                                prop.get("value")
                                for prop in item.get("singleValueExtendedProperties", [])
                                if prop.get("id") == MICROSOFT_GTS_MEETING_PROPERTY
                            ),
                            None,
                        ),
                        "raw_payload": item,
                    },
                )
                count += 1
            url = payload.get("@odata.nextLink")
            first_page = False
    return count


def _unfold_ical(text):
    return re.sub(r"\r?\n[ \t]", "", text)


def _ical_value(block, name):
    match = re.search(rf"^{re.escape(name)}(?:;[^:]*)?:(.*)$", block, flags=re.MULTILINE | re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _ical_datetime(value):
    value = value.strip()
    formats = ["%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d"]
    for fmt in formats:
        try:
            parsed = datetime.strptime(value, fmt)
            return parsed.replace(tzinfo=dt_timezone.utc)
        except ValueError:
            continue
    return None


def pull_caldav(connection, *, range_start, range_end):
    credentials = _json_credentials(connection)
    calendar_urls = connection.selected_calendars or [
        item["id"] for item in discover_caldav_calendars(connection) if item["primary"]
    ]
    headers = {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"}
    body = f"""<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="{range_start.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")}" end="{range_end.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>"""
    count = 0
    for server_url in calendar_urls:
        response = requests.request(
            "REPORT",
            server_url,
            headers=headers,
            data=body.encode(),
            auth=(credentials.get("username", ""), credentials.get("app_password", "")),
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code not in (200, 207):
            raise CalendarProviderError(f"CalDAV server returned HTTP {response.status_code}.")
        root = ElementTree.fromstring(response.content)
        for response_node in root.findall("{DAV:}response"):
            href = response_node.findtext("{DAV:}href") or ""
            data_node = response_node.find(".//{urn:ietf:params:xml:ns:caldav}calendar-data")
            if data_node is None or not data_node.text:
                continue
            text = _unfold_ical(data_node.text)
            for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, flags=re.DOTALL | re.IGNORECASE):
                starts_at = _ical_datetime(_ical_value(block, "DTSTART"))
                ends_at = _ical_datetime(_ical_value(block, "DTEND"))
                event_id = _ical_value(block, "UID") or href
                _upsert_event(
                    connection,
                    {
                        "id": event_id,
                        "calendar_id": server_url,
                        "title": _ical_value(block, "SUMMARY"),
                        "starts_at": starts_at,
                        "ends_at": ends_at,
                        "all_day": len(_ical_value(block, "DTSTART")) == 8,
                        "provider_updated_at": _ical_datetime(_ical_value(block, "LAST-MODIFIED")),
                        "etag": response_node.findtext(".//{DAV:}getetag") or "",
                        "deleted": _ical_value(block, "STATUS").upper() == "CANCELLED",
                        "raw_payload": {"href": href},
                    },
                )
                count += 1
    return count


def sync_connection(connection, *, range_start=None, range_end=None):
    if connection.sync_mode in (CalendarSyncMode.DISABLED, CalendarSyncMode.OUTBOUND_GTS):
        return 0
    range_start = range_start or timezone.now() - timedelta(days=90)
    range_end = range_end or timezone.now() + timedelta(days=730)
    try:
        if connection.provider == CalendarProvider.GOOGLE:
            count = pull_google(connection, range_start=range_start, range_end=range_end)
        elif connection.provider == CalendarProvider.MICROSOFT:
            count = pull_microsoft(connection, range_start=range_start, range_end=range_end)
        else:
            count = pull_caldav(connection, range_start=range_start, range_end=range_end)
        CalendarConnection.objects.filter(pk=connection.pk).update(
            status=CalendarConnectionStatus.CONNECTED,
            last_synced_at=timezone.now(),
            last_error="",
            last_error_at=None,
        )
        return count
    except Exception as exc:
        CalendarConnection.objects.filter(pk=connection.pk).update(
            status=CalendarConnectionStatus.ERROR,
            last_error=str(exc)[:2000],
            last_error_at=timezone.now(),
        )
        raise


def _meeting_payload(meeting):
    description_parts = [meeting.description]
    if meeting.issue_id:
        description_parts.append(
            f"GTS task: {meeting.task_snapshot.get('identifier', '')}-{meeting.task_snapshot.get('sequence_id', '')}"
        )
    if meeting.meeting_url:
        description_parts.append(meeting.meeting_url)
    return {
        "title": meeting.title,
        "description": "\n\n".join(part for part in description_parts if part),
        "starts_at": meeting.starts_at,
        "ends_at": meeting.ends_at,
        "all_day": meeting.all_day,
        "location": meeting.location,
        "cancelled": meeting.status == MeetingStatus.CANCELLED,
    }


def _recurrence_lines(meeting):
    if not meeting.recurrence_rule:
        return []
    lines = [f"RRULE:{meeting.recurrence_rule.removeprefix('RRULE:')}"]
    cancelled = meeting.recurrence_exceptions.filter(action="CANCELLED", deleted_at__isnull=True).order_by(
        "original_starts_at"
    )
    lines.extend(
        f"EXDATE:{item.original_starts_at.astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}" for item in cancelled
    )
    return lines


def _parse_rrule(value):
    """Return a normalized mapping for the RFC 5545 subset used by GTS."""
    rule = (value or "").removeprefix("RRULE:")
    return {key.upper(): item for part in rule.split(";") if "=" in part for key, item in [part.split("=", 1)]}


def _microsoft_recurrence(meeting):
    """Translate GTS recurrence into Microsoft Graph patternedRecurrence."""
    if not meeting.recurrence_rule:
        return None

    rule = _parse_rrule(meeting.recurrence_rule)
    frequency = rule.get("FREQ", "").upper()
    interval = max(int(rule.get("INTERVAL", "1") or 1), 1)
    start = meeting.starts_at.astimezone(dt_timezone.utc)
    weekday_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    byday_names = {
        "MO": "monday",
        "TU": "tuesday",
        "WE": "wednesday",
        "TH": "thursday",
        "FR": "friday",
        "SA": "saturday",
        "SU": "sunday",
    }

    if frequency == "DAILY":
        pattern = {"type": "daily", "interval": interval}
    elif frequency == "WEEKLY":
        days = [byday_names[item[-2:]] for item in rule.get("BYDAY", "").split(",") if item[-2:] in byday_names]
        pattern = {
            "type": "weekly",
            "interval": interval,
            "daysOfWeek": days or [weekday_names[start.weekday()]],
            "firstDayOfWeek": "monday",
        }
    elif frequency == "MONTHLY":
        pattern = {
            "type": "absoluteMonthly",
            "interval": interval,
            "dayOfMonth": int(rule.get("BYMONTHDAY") or start.day),
        }
    elif frequency == "YEARLY":
        pattern = {
            "type": "absoluteYearly",
            "interval": interval,
            "month": int(rule.get("BYMONTH") or start.month),
            "dayOfMonth": int(rule.get("BYMONTHDAY") or start.day),
        }
    else:
        raise CalendarProviderError(
            f"Microsoft Calendar does not support recurrence frequency {frequency or 'UNKNOWN'}."
        )

    recurrence_range = {"type": "noEnd", "startDate": start.date().isoformat()}
    if rule.get("COUNT"):
        recurrence_range.update(type="numbered", numberOfOccurrences=max(int(rule["COUNT"]), 1))
    elif rule.get("UNTIL"):
        until_value = rule["UNTIL"]
        until = None
        for date_format in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d"):
            try:
                until = datetime.strptime(until_value, date_format)
                break
            except ValueError:
                continue
        if until is None:
            raise CalendarProviderError("Microsoft Calendar cannot parse the recurrence end date.")
        recurrence_range.update(type="endDate", endDate=until.date().isoformat())

    return {"pattern": pattern, "range": recurrence_range}


def _upsert_google_meeting(connection, meeting, existing):
    payload = _meeting_payload(meeting)
    calendar_id = (connection.selected_calendars or ["primary"])[0]
    if payload["all_day"]:
        local_start = payload["starts_at"].astimezone(ZoneInfo(meeting.timezone))
        local_end = payload["ends_at"].astimezone(ZoneInfo(meeting.timezone))
        event_start = {"date": local_start.date().isoformat()}
        event_end = {"date": local_end.date().isoformat()}
    else:
        event_start = {"dateTime": payload["starts_at"].isoformat(), "timeZone": meeting.timezone}
        event_end = {"dateTime": payload["ends_at"].isoformat(), "timeZone": meeting.timezone}
    event = {
        "summary": payload["title"],
        "description": payload["description"],
        "location": payload["location"],
        "start": event_start,
        "end": event_end,
        "extendedProperties": {"private": {"gtsMeetingId": str(meeting.id)}},
        "status": "cancelled" if payload["cancelled"] else "confirmed",
    }
    recurrence = _recurrence_lines(meeting)
    if recurrence:
        event["recurrence"] = recurrence
    base = f"https://www.googleapis.com/calendar/v3/calendars/{quote(str(calendar_id), safe='')}/events"
    if existing:
        response = _authorized_request(
            connection, "PUT", f"{base}/{quote(existing.provider_event_id, safe='')}", json=event
        )
    else:
        response = _authorized_request(connection, "POST", base, json=event)
    if not response.ok:
        raise CalendarProviderError(f"Google Calendar returned HTTP {response.status_code} while saving an event.")
    item = response.json()
    return item["id"], str(calendar_id), item


def _upsert_microsoft_meeting(connection, meeting, existing):
    payload = _meeting_payload(meeting)
    event = {
        "subject": payload["title"],
        "body": {"contentType": "text", "content": payload["description"]},
        "start": {
            "dateTime": payload["starts_at"].astimezone(dt_timezone.utc).replace(tzinfo=None).isoformat(),
            "timeZone": "UTC",
        },
        "end": {
            "dateTime": payload["ends_at"].astimezone(dt_timezone.utc).replace(tzinfo=None).isoformat(),
            "timeZone": "UTC",
        },
        "location": {"displayName": payload["location"]},
        "showAs": "busy",
        "isAllDay": payload["all_day"],
        "categories": ["GTS Tasks System"],
        "singleValueExtendedProperties": [
            {"id": MICROSOFT_GTS_MEETING_PROPERTY, "value": str(meeting.id)},
        ],
    }
    recurrence = _microsoft_recurrence(meeting)
    if recurrence:
        event["recurrence"] = recurrence
    calendar_id = (connection.selected_calendars or ["primary"])[0]
    events_base = (
        "https://graph.microsoft.com/v1.0/me/events"
        if calendar_id == "primary"
        else f"https://graph.microsoft.com/v1.0/me/calendars/{quote(str(calendar_id), safe='')}/events"
    )
    if existing:
        url = f"{events_base}/{quote(existing.provider_event_id, safe='')}"
        if payload["cancelled"]:
            response = _authorized_request(connection, "DELETE", url)
            if response.status_code not in (204, 404):
                raise CalendarProviderError(f"Microsoft Calendar returned HTTP {response.status_code}.")
            return existing.provider_event_id, str(calendar_id), {}
        response = _authorized_request(connection, "PATCH", url, json=event)
    else:
        if payload["cancelled"]:
            return "", str(calendar_id), {}
        response = _authorized_request(connection, "POST", events_base, json=event)
    if not response.ok:
        raise CalendarProviderError(f"Microsoft Calendar returned HTTP {response.status_code} while saving an event.")
    item = response.json()
    return item["id"], str(calendar_id), item


def _ical_escape(value):
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _upsert_caldav_meeting(connection, meeting, existing):
    payload = _meeting_payload(meeting)
    credentials = _json_credentials(connection)
    server_url = ((connection.selected_calendars or [_server_url(connection)])[0]).rstrip("/") + "/"
    event_id = existing.provider_event_id if existing else f"gts-{meeting.id}"
    target = urljoin(server_url, f"{quote(event_id, safe='')}.ics")
    status = "CANCELLED" if payload["cancelled"] else "CONFIRMED"
    if payload["all_day"]:
        local_start = payload["starts_at"].astimezone(ZoneInfo(meeting.timezone))
        local_end = payload["ends_at"].astimezone(ZoneInfo(meeting.timezone))
        date_lines = [
            f"DTSTART;VALUE=DATE:{local_start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{local_end.strftime('%Y%m%d')}",
        ]
    else:
        date_lines = [
            f"DTSTART:{payload['starts_at'].astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTEND:{payload['ends_at'].astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        ]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//GTS Tasks System//Calendar//EN",
        "BEGIN:VEVENT",
        f"UID:{event_id}",
        f"DTSTAMP:{timezone.now().astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        *date_lines,
        f"SUMMARY:{_ical_escape(payload['title'])}",
        f"DESCRIPTION:{_ical_escape(payload['description'])}",
        f"LOCATION:{_ical_escape(payload['location'])}",
        f"STATUS:{status}",
    ]
    lines.extend(_recurrence_lines(meeting))
    lines.extend(
        [
            "END:VEVENT",
            "END:VCALENDAR",
            "",
        ]
    )
    ics = "\r\n".join(lines)
    response = requests.put(
        target,
        data=ics.encode(),
        headers={"Content-Type": "text/calendar; charset=utf-8"},
        auth=(credentials.get("username", ""), credentials.get("app_password", "")),
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code not in (200, 201, 204):
        raise CalendarProviderError(f"CalDAV server returned HTTP {response.status_code} while saving an event.")
    return event_id, server_url, {"href": target}


@transaction.atomic
def sync_meeting_to_connection(meeting, connection):
    if connection.status == CalendarConnectionStatus.PAUSED or connection.sync_mode not in (
        CalendarSyncMode.FULL,
        CalendarSyncMode.OUTBOUND_GTS,
    ):
        return None
    existing = MeetingExternalEvent.objects.filter(meeting=meeting, connection=connection).first()
    if meeting.status == MeetingStatus.CANCELLED and existing is None:
        return None
    if connection.provider == CalendarProvider.GOOGLE:
        event_id, calendar_id, raw = _upsert_google_meeting(connection, meeting, existing)
    elif connection.provider == CalendarProvider.MICROSOFT:
        event_id, calendar_id, raw = _upsert_microsoft_meeting(connection, meeting, existing)
    else:
        event_id, calendar_id, raw = _upsert_caldav_meeting(connection, meeting, existing)
    if not event_id:
        return existing
    defaults = {
        "provider_event_id": event_id,
        "provider_calendar_id": calendar_id,
        "title": meeting.title,
        "starts_at": meeting.starts_at,
        "ends_at": meeting.ends_at,
        "all_day": meeting.all_day,
        "availability": meeting.availability,
        "raw_payload_encrypted": encrypt_data(json.dumps(raw)),
        "is_deleted_at_provider": meeting.status == MeetingStatus.CANCELLED,
    }
    if existing:
        for field, value in defaults.items():
            setattr(existing, field, value)
        existing.save()
        return existing
    return MeetingExternalEvent.objects.create(meeting=meeting, connection=connection, **defaults)


def sync_meeting(meeting):
    user_ids = set(
        meeting.participants.filter(user__isnull=False, removed_at__isnull=True).values_list("user_id", flat=True)
    )
    user_ids.add(meeting.organizer_id)
    connections = CalendarConnection.objects.filter(
        user_id__in=user_ids,
        status__in=[CalendarConnectionStatus.CONNECTED, CalendarConnectionStatus.ERROR],
        sync_mode__in=[CalendarSyncMode.FULL, CalendarSyncMode.OUTBOUND_GTS],
    )
    results = []
    for connection in connections:
        try:
            sync_meeting_to_connection(meeting, connection)
            CalendarConnection.objects.filter(pk=connection.pk).update(
                status=CalendarConnectionStatus.CONNECTED,
                last_error="",
                last_error_at=None,
                last_synced_at=timezone.now(),
            )
            results.append({"connection_id": str(connection.id), "ok": True})
        except Exception as exc:
            CalendarConnection.objects.filter(pk=connection.pk).update(
                status=CalendarConnectionStatus.ERROR,
                last_error=str(exc)[:2000],
                last_error_at=timezone.now(),
            )
            results.append({"connection_id": str(connection.id), "ok": False, "error": str(exc)})
    return results


def safe_return_url(value, request):
    fallback = "/profile/settings/calendars"
    if not value:
        return fallback
    parsed = urlparse(value)
    if not parsed.netloc:
        return value if value.startswith("/") else fallback
    allowed_hosts = {request.get_host().split(":")[0]}
    web_url = getattr(settings, "WEB_URL", "") or ""
    if web_url:
        allowed_hosts.add(urlparse(web_url).hostname)
    return value if parsed.hostname in allowed_hosts else fallback
