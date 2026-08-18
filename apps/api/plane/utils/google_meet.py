# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import requests

from plane.license.utils.instance_value import get_calendar_configuration

from .external_calendar import CalendarProviderError, HTTP_TIMEOUT


def _system_access_token():
    config = get_calendar_configuration()
    client_id = config["CALENDAR_GOOGLE_CLIENT_ID"]
    client_secret = config["CALENDAR_GOOGLE_CLIENT_SECRET"]
    refresh_token = config["CALENDAR_GOOGLE_MEET_REFRESH_TOKEN"]
    if not client_id or not client_secret or not refresh_token:
        raise CalendarProviderError("The system Google Meet account is not configured.")
    response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=HTTP_TIMEOUT,
    )
    if not response.ok:
        raise CalendarProviderError("The system Google Meet authorization has expired.")
    return response.json()["access_token"]


def create_open_google_meet():
    """Create an OPEN Meet space with the instance service account.

    The GTS meeting creator remains the organizer in the product and invitation;
    the configured Workspace account is only the technical owner of the Meet space.
    """
    response = requests.post(
        "https://meet.googleapis.com/v2/spaces",
        headers={"Authorization": f"Bearer {_system_access_token()}", "Content-Type": "application/json"},
        json={"config": {"accessType": "OPEN", "entryPointAccess": "ALL"}},
        timeout=HTTP_TIMEOUT,
    )
    if not response.ok:
        raise CalendarProviderError(f"Google Meet returned HTTP {response.status_code}.")
    payload = response.json()
    return payload.get("meetingUri", ""), payload.get("name", "")
