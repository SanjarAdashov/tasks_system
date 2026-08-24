import hashlib
import secrets
from datetime import datetime, time, timedelta, timezone as dt_timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from django.core import signing
from django.db.models import Q
from django.utils import timezone

from plane.db.models import (
    CalendarConnectionStatus,
    CalendarPreference,
    Meeting,
    MeetingAvailability,
    MeetingExternalEvent,
    MeetingParticipant,
    MeetingParticipantSource,
    MeetingStatus,
    ProjectMember,
    User,
    WorkspaceHoliday,
    WorkspaceMember,
)
from plane.utils.issue_access import (
    is_instance_admin,
    is_project_admin,
    member_property_user_ids,
)


CALENDAR_TOKEN_SALT = "gts-calendar-public-v1"


def opaque_token_hash():
    return hashlib.sha256(secrets.token_bytes(32)).hexdigest()


def sign_meeting_token(meeting_id):
    return signing.dumps({"meeting_id": str(meeting_id)}, salt=CALENDAR_TOKEN_SALT, compress=True)


def sign_participant_token(participant_id):
    return signing.dumps({"participant_id": str(participant_id)}, salt=CALENDAR_TOKEN_SALT, compress=True)


def read_signed_calendar_token(token, *, max_age=None):
    return signing.loads(token, salt=CALENDAR_TOKEN_SALT, max_age=max_age)


def recurrence_occurs_at(meeting, value):
    """Check that an occurrence timestamp belongs to the meeting's series."""
    if not meeting.recurrence_rule:
        return False
    expected = value.replace(microsecond=0)
    try:
        rule = rrulestr(meeting.recurrence_rule.removeprefix("RRULE:"), dtstart=meeting.starts_at)
        candidate = rule.before(expected + timedelta(seconds=1), inc=True)
    except (TypeError, ValueError, OverflowError):
        return False
    return bool(candidate and candidate.replace(microsecond=0) == expected)


def active_workspace_member(user, workspace_id):
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and WorkspaceMember.objects.filter(
            workspace_id=workspace_id,
            member_id=user.id,
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).exists()
    )


def active_project_member(user, project_id):
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and ProjectMember.objects.filter(
            project_id=project_id,
            member_id=user.id,
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).exists()
    )


def meeting_detail_access(user, meeting):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if meeting.organizer_id == user.id:
        return True
    if meeting.participants.filter(user_id=user.id, removed_at__isnull=True).exists():
        return True
    return False


def meeting_manage_access(user, meeting):
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and (
            is_instance_admin(user)
            or meeting.organizer_id == user.id
            or (meeting.project_id and is_project_admin(user, meeting.project_id))
        )
    )


def meetings_visible_to(queryset, user, workspace=None):
    if not user or not getattr(user, "is_authenticated", False):
        return queryset.none()
    visible = queryset.filter(
        Q(organizer_id=user.id)
        | Q(participants__user_id=user.id, participants__removed_at__isnull=True)
    )
    if workspace is not None:
        visible = visible.filter(workspace=workspace)
    return visible.distinct()


def meeting_participant_payload(user, *, source, source_identifier=None, role="REQUIRED"):
    return {
        "user_id": str(user.id),
        "email": user.email,
        "name": user.full_name or user.email,
        "role": role,
        "source": source,
        "source_identifier": str(source_identifier) if source_identifier else None,
    }


def issue_meeting_participants(issue, organizer):
    """Build the agreed task-derived participant snapshot without granting task access."""
    source_by_user = {}

    def add(user_id, source, source_identifier=None):
        if not user_id:
            return
        key = str(user_id)
        source_by_user.setdefault(
            key,
            {"source": source, "source_identifier": source_identifier},
        )

    add(organizer.id, MeetingParticipantSource.ORGANIZER)
    add(issue.created_by_id, MeetingParticipantSource.TASK_CREATOR)
    for assignee_id in issue.issue_assignee.values_list("assignee_id", flat=True):
        add(assignee_id, MeetingParticipantSource.TASK_ASSIGNEE)
    for property_id, user_ids in member_property_user_ids(issue).items():
        for user_id in user_ids:
            add(user_id, MeetingParticipantSource.TASK_PROPERTY, property_id)
    for subscriber_id in issue.issue_subscribers.values_list("subscriber_id", flat=True):
        add(subscriber_id, MeetingParticipantSource.TASK_SUBSCRIBER)

    for link in issue.access_group_links.select_related("group").prefetch_related("group__memberships"):
        for membership in link.group.memberships.all():
            if membership.deleted_at is None:
                add(membership.member_id, MeetingParticipantSource.TASK_GROUP, link.group_id)

    active_ids = set(
        ProjectMember.objects.filter(
            project_id=issue.project_id,
            member_id__in=source_by_user.keys(),
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).values_list("member_id", flat=True)
    )
    users = User.objects.filter(id__in=active_ids).order_by("first_name", "last_name", "email")
    return [
        meeting_participant_payload(
            user,
            source=source_by_user[str(user.id)]["source"],
            source_identifier=source_by_user[str(user.id)]["source_identifier"],
        )
        for user in users
    ]


def replace_meeting_participants(meeting, participants, *, actor):
    desired_user_ids = set()
    desired_emails = set()
    rows = []
    for item in participants:
        user = item.get("user")
        email = (item.get("email") or (user.email if user else "")).strip().lower()
        if not email:
            continue
        if user:
            desired_user_ids.add(user.id)
        desired_emails.add(email)
        rows.append((item, user, email))

    organizer_email = (meeting.organizer.email or "").strip().lower()
    if meeting.organizer_id not in desired_user_ids:
        rows.insert(
            0,
            (
                {
                    "name": meeting.organizer.full_name or meeting.organizer.email,
                    "role": "REQUIRED",
                    "source": MeetingParticipantSource.ORGANIZER,
                },
                meeting.organizer,
                organizer_email,
            ),
        )
        desired_user_ids.add(meeting.organizer_id)
        desired_emails.add(organizer_email)

    MeetingParticipant.objects.filter(meeting=meeting).exclude(
        Q(user_id__in=desired_user_ids) | Q(email__in=desired_emails)
    ).update(removed_at=timezone.now())

    for item, user, email in rows:
        lookup = Q(meeting=meeting, user=user) if user else Q(meeting=meeting, email=email)
        participant = MeetingParticipant.all_objects.filter(lookup).order_by("-created_at").first()
        values = {
            "user": user,
            "email": email,
            "name": item.get("name") or ((user.full_name or user.email) if user else ""),
            "role": item.get("role") or "REQUIRED",
            "source": item.get("source") or MeetingParticipantSource.EXPLICIT,
            "source_identifier": item.get("source_identifier"),
            "removed_at": None,
            "deleted_at": None,
        }
        if user and user.id == meeting.organizer_id:
            values["response_status"] = "ACCEPTED"
            values["responded_at"] = timezone.now()
        if participant:
            for field, value in values.items():
                setattr(participant, field, value)
            participant.save()
        else:
            MeetingParticipant.objects.create(
                meeting=meeting,
                response_token_hash=opaque_token_hash(),
                created_by_id=getattr(actor, "id", None),
                **values,
            )


def parse_range(value, *, fallback):
    if not value:
        return fallback
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed, dt_timezone.utc)


def expand_recurrence(meeting, range_start, range_end, *, limit=500):
    """Return occurrence dictionaries; malformed rules safely fall back to the base event."""
    duration = meeting.ends_at - meeting.starts_at
    base = {
        "occurrence_id": f"{meeting.id}:{meeting.starts_at.isoformat()}",
        "original_starts_at": meeting.starts_at,
        "starts_at": meeting.starts_at,
        "ends_at": meeting.ends_at,
    }
    if not meeting.recurrence_rule:
        return [base] if meeting.starts_at < range_end and meeting.ends_at > range_start else []
    try:
        rule = rrulestr(meeting.recurrence_rule, dtstart=meeting.starts_at)
        starts = rule.between(range_start - duration, range_end, inc=True)
    except (ValueError, TypeError, OverflowError):
        return [base] if meeting.starts_at < range_end and meeting.ends_at > range_start else []

    exceptions = {item.original_starts_at: item for item in meeting.recurrence_exceptions.all()}
    result = []
    for occurrence_start in starts[:limit]:
        exception = exceptions.get(occurrence_start)
        if exception and exception.action == "CANCELLED":
            continue
        occurrence = {
            "occurrence_id": f"{meeting.id}:{occurrence_start.isoformat()}",
            "original_starts_at": occurrence_start,
            "starts_at": occurrence_start,
            "ends_at": occurrence_start + duration,
        }
        if exception:
            occurrence.update(exception.overrides)
        result.append(occurrence)
    return result


def user_busy_intervals(user_ids, range_start, range_end, *, exclude_meeting_id=None):
    user_ids = [UUID(str(value)) for value in user_ids]
    meetings = (
        Meeting.objects.filter(
            Q(organizer_id__in=user_ids) | Q(participants__user_id__in=user_ids, participants__removed_at__isnull=True),
            status=MeetingStatus.PLANNED,
            availability__in=[MeetingAvailability.BUSY, MeetingAvailability.MAYBE, MeetingAvailability.AWAY],
        )
        .filter(Q(starts_at__lt=range_end, ends_at__gt=range_start) | ~Q(recurrence_rule=""))
        .distinct()
    )
    if exclude_meeting_id:
        meetings = meetings.exclude(id=exclude_meeting_id)

    result = {str(user_id): [] for user_id in user_ids}
    for meeting in meetings.prefetch_related("participants", "recurrence_exceptions"):
        attendees = set(
            meeting.participants.filter(user_id__in=user_ids, removed_at__isnull=True).values_list("user_id", flat=True)
        )
        if meeting.organizer_id in user_ids:
            attendees.add(meeting.organizer_id)
        occurrences = expand_recurrence(meeting, range_start, range_end)
        for occurrence in occurrences:
            for user_id in attendees:
                result[str(user_id)].append(
                    {
                        "starts_at": occurrence["starts_at"],
                        "ends_at": occurrence["ends_at"],
                        "source": "GTS",
                    }
                )

    external_events = MeetingExternalEvent.objects.filter(
        connection__user_id__in=user_ids,
        connection__status__in=[
            CalendarConnectionStatus.CONNECTED,
            CalendarConnectionStatus.PARTIAL,
        ],
        is_deleted_at_provider=False,
        availability__in=[MeetingAvailability.BUSY, MeetingAvailability.MAYBE, MeetingAvailability.AWAY],
        starts_at__lt=range_end,
        ends_at__gt=range_start,
    ).select_related("connection")
    for event in external_events:
        result[str(event.connection.user_id)].append(
            {"starts_at": event.starts_at, "ends_at": event.ends_at, "source": event.connection.provider}
        )
    return result


def workspace_holiday_for_date(workspace_id, value):
    rows = WorkspaceHoliday.objects.filter(workspace_id=workspace_id, date=value).order_by("is_override", "source")
    override = next((row for row in rows if row.is_override), None)
    return override or rows.first()


def within_working_hours(user, value_start, value_end, working_hours):
    try:
        user_working_hours = user.calendar_preference.working_hours
    except (AttributeError, CalendarPreference.DoesNotExist):
        user_working_hours = working_hours
    try:
        user_zone = ZoneInfo(user.user_timezone or "UTC")
    except ZoneInfoNotFoundError:
        user_zone = ZoneInfo("UTC")
    local_start = value_start.astimezone(user_zone)
    local_end = value_end.astimezone(user_zone)
    day = user_working_hours.get(str(local_start.isoweekday()), {})
    if not day.get("enabled") or local_start.date() != local_end.date():
        return False
    try:
        day_start = time.fromisoformat(day["start"])
        day_end = time.fromisoformat(day["end"])
    except (KeyError, TypeError, ValueError):
        return False
    return local_start.time() >= day_start and local_end.time() <= day_end


def find_available_slots(
    *,
    users,
    required_user_ids,
    optional_user_ids,
    range_start,
    range_end,
    duration_minutes,
    working_hours,
    workspace_id,
    limit=12,
):
    required = {str(value) for value in required_user_ids}
    optional = {str(value) for value in optional_user_ids}
    user_map = {str(user.id): user for user in users}
    busy = user_busy_intervals(required | optional, range_start, range_end)
    holiday_rows = WorkspaceHoliday.objects.filter(
        workspace_id=workspace_id,
        date__gte=(range_start - timedelta(days=1)).date(),
        date__lte=(range_end + timedelta(days=1)).date(),
    ).order_by("date", "is_override", "source")
    holidays_by_date = {}
    for holiday in holiday_rows:
        if holiday.date not in holidays_by_date or holiday.is_override:
            holidays_by_date[holiday.date] = holiday
    duration = timedelta(minutes=max(5, int(duration_minutes)))
    cursor = range_start.replace(second=0, microsecond=0)
    remainder = cursor.minute % 15
    if remainder:
        cursor += timedelta(minutes=15 - remainder)
    candidates = []
    while cursor + duration <= range_end and len(candidates) < 5000:
        slot_end = cursor + duration
        required_conflicts = []
        optional_conflicts = []
        outside_hours = []
        for user_id in required | optional:
            conflicts = any(
                interval["starts_at"] < slot_end and interval["ends_at"] > cursor for interval in busy.get(user_id, [])
            )
            if conflicts:
                (required_conflicts if user_id in required else optional_conflicts).append(user_id)
            user = user_map.get(user_id)
            if user and not within_working_hours(user, cursor, slot_end, working_hours):
                outside_hours.append(user_id)
            if user and workspace_id:
                try:
                    user_zone = ZoneInfo(user.user_timezone or "UTC")
                except ZoneInfoNotFoundError:
                    user_zone = ZoneInfo("UTC")
                holiday = holidays_by_date.get(cursor.astimezone(user_zone).date())
                if holiday and holiday.kind != WorkspaceHoliday.Kind.WORKDAY:
                    outside_hours.append(user_id)
        if not required_conflicts:
            candidates.append(
                {
                    "starts_at": cursor,
                    "ends_at": slot_end,
                    "optional_conflicts": optional_conflicts,
                    "outside_working_hours": sorted(set(outside_hours)),
                    "score": len(optional_conflicts) * 10 + len(set(outside_hours)),
                }
            )
        cursor += timedelta(minutes=15)
    candidates.sort(key=lambda item: (item["score"], item["starts_at"]))
    return candidates[:limit]


def complete_finished_meetings(now=None):
    now = now or timezone.now()
    return Meeting.objects.filter(status=MeetingStatus.PLANNED, ends_at__lte=now, recurrence_rule="").update(
        status=MeetingStatus.COMPLETED,
        completed_at=now,
    )
