# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from celery import shared_task

from plane.db.models import CalendarConnection, CalendarConnectionStatus, Meeting
from plane.utils.external_calendar import sync_connection, sync_meeting
from plane.utils.holiday_calendar import sync_enabled_workspaces


@shared_task
def sync_official_holiday_calendars():
    """Refresh official holiday calendars for every opted-in workspace."""
    return sync_enabled_workspaces()


@shared_task
def sync_calendar_connection(connection_id):
    connection = CalendarConnection.objects.filter(pk=connection_id).first()
    if not connection:
        return {"skipped": True}
    try:
        return {"events": sync_connection(connection)}
    except Exception as exc:
        return {"error": str(exc)}


@shared_task
def sync_all_calendar_connections():
    connection_ids = CalendarConnection.objects.filter(
        status__in=[CalendarConnectionStatus.CONNECTED, CalendarConnectionStatus.ERROR]
    ).values_list("id", flat=True)
    for connection_id in connection_ids.iterator(chunk_size=250):
        sync_calendar_connection.delay(str(connection_id))
    return {"queued": True}


@shared_task
def sync_meeting_to_external_calendars(meeting_id):
    meeting = Meeting.objects.filter(pk=meeting_id).first()
    return sync_meeting(meeting) if meeting else {"skipped": True}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def finalize_deleted_meeting(self, meeting_id):
    """Cancel provider copies, notify participants, then remove the hidden GTS record."""
    meeting = Meeting.all_objects.filter(pk=meeting_id).first()
    if not meeting:
        return {"skipped": True}
    results = sync_meeting(meeting)
    failures = [item for item in results if not item.get("ok")]
    if failures:
        raise RuntimeError("One or more external calendars rejected meeting cancellation.")

    from plane.bgtasks.calendar_notification_task import send_meeting_notifications

    send_meeting_notifications(str(meeting.id), "CANCELLED", include_deleted=True)
    meeting.delete(soft=False)
    return {"deleted": True}
