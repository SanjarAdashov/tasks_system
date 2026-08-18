# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Import the official Uzbekistan working calendar from my.gov.uz.

The source page is server-rendered, so this intentionally parses the semantic
month/day grid instead of depending on a private JSON endpoint.  Regular
Saturday/Sunday dates are calculated by clients and are not persisted; only
official holidays, extra days off, and transferred working days are stored.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup
from django.db import transaction
from django.utils import timezone

from plane.db.models import WorkspaceCalendarSettings, WorkspaceHoliday


RUSSIAN_MONTHS = {
    "Январь": 1,
    "Февраль": 2,
    "Март": 3,
    "Апрель": 4,
    "Май": 5,
    "Июнь": 6,
    "Июль": 7,
    "Август": 8,
    "Сентябрь": 9,
    "Октябрь": 10,
    "Ноябрь": 11,
    "Декабрь": 12,
}


class HolidayCalendarError(RuntimeError):
    pass


@dataclass(frozen=True)
class OfficialCalendarDay:
    date: date
    kind: str
    name: str
    source_payload: dict


def _calendar_link_names(soup):
    names = {}
    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if "calendar.google.com/calendar/render" not in href:
            continue
        query = parse_qs(urlparse(href).query)
        raw_dates = (query.get("dates") or [""])[0]
        title = (query.get("text") or [""])[0].strip()
        if "/" not in raw_dates or not title:
            continue
        raw_start, raw_end = raw_dates.split("/", 1)
        try:
            start = datetime.strptime(raw_start[:8], "%Y%m%d").date()
            end = datetime.strptime(raw_end[:8], "%Y%m%d").date()
        except ValueError:
            continue
        cursor = start
        while cursor < end:
            names[cursor] = title
            cursor += timedelta(days=1)
    return names


def parse_my_gov_calendar(html):
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text(" ", strip=True)
    year_match = re.search(r"(?:Производственный календарь|Выходные дни)[^0-9]{0,80}(20\d{2})", page_text)
    if not year_match:
        year_match = re.search(r"\b(20\d{2})\b", page_text)
    if not year_match:
        raise HolidayCalendarError("The official calendar year could not be detected.")
    year = int(year_match.group(1))
    linked_names = _calendar_link_names(soup)
    records = []

    for month_name, month_number in RUSSIAN_MONTHS.items():
        heading = soup.find("span", string=lambda value: isinstance(value, str) and value.strip() == month_name)
        if heading is None or heading.parent is None or heading.parent.parent is None:
            raise HolidayCalendarError(f"Month {month_name} is missing from the official calendar.")
        card = heading.parent.parent
        buttons = card.find_all("button")
        expected_days = calendar.monthrange(year, month_number)[1]
        if len(buttons) < expected_days:
            raise HolidayCalendarError(f"Month {month_name} contains an incomplete day grid.")

        for button in buttons[:expected_days]:
            value = button.get_text(" ", strip=True)
            if not value.isdigit():
                continue
            current = date(year, month_number, int(value))
            classes = set(button.get("class") or [])
            is_official_day = "bg-default" in classes and "text-white" in classes
            is_transferred_workday = "border-dashed" in classes and (
                "border-yellow-400" in classes or "border-yellow-500" in classes
            )
            is_day_off = "text-red-500" in classes or "bg-red-50" in classes

            if is_transferred_workday:
                kind = WorkspaceHoliday.Kind.WORKDAY
                name = "Перенесённый рабочий день"
            elif is_official_day:
                kind = WorkspaceHoliday.Kind.HOLIDAY
                name = linked_names.get(current, "Официальный выходной день")
            elif is_day_off and current.weekday() < 5:
                kind = WorkspaceHoliday.Kind.DAY_OFF
                name = linked_names.get(current, "Дополнительный выходной день")
            else:
                continue

            records.append(
                OfficialCalendarDay(
                    date=current,
                    kind=kind,
                    name=name,
                    source_payload={
                        "year": year,
                        "month": month_number,
                        "classes": sorted(classes),
                    },
                )
            )
    return year, records


def fetch_my_gov_calendar(url, *, timeout=20):
    try:
        response = requests.get(
            url,
            timeout=timeout,
            headers={"User-Agent": "GTS-Tasks-Calendar/1.0 (+https://tasks.globaltravel.space)"},
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HolidayCalendarError("The official holiday calendar is temporarily unavailable.") from exc
    return parse_my_gov_calendar(response.text)


@transaction.atomic
def sync_workspace_holidays(settings, *, html=None):
    if not settings.holiday_sync_enabled:
        return {"skipped": True, "reason": "disabled", "created": 0, "updated": 0, "deleted": 0}
    try:
        year, records = (
            parse_my_gov_calendar(html) if html is not None else fetch_my_gov_calendar(settings.holiday_source_url)
        )
        if not records:
            raise HolidayCalendarError("The official calendar did not contain special dates.")

        source_keys = {day.date.isoformat() for day in records}
        stale = WorkspaceHoliday.objects.filter(
            workspace=settings.workspace,
            source=WorkspaceHoliday.Source.MY_GOV,
            date__year=year,
        ).exclude(source_key__in=source_keys)
        deleted = stale.count()
        stale.delete()

        created = 0
        updated = 0
        for day in records:
            _, was_created = WorkspaceHoliday.objects.update_or_create(
                workspace=settings.workspace,
                date=day.date,
                source=WorkspaceHoliday.Source.MY_GOV,
                defaults={
                    "name": day.name,
                    "kind": day.kind,
                    "source_key": day.date.isoformat(),
                    "source_payload": {
                        **day.source_payload,
                        "source_url": settings.holiday_source_url,
                    },
                    "is_override": False,
                },
            )
            created += int(was_created)
            updated += int(not was_created)

        settings.holiday_last_synced_at = timezone.now()
        settings.holiday_last_error = ""
        settings.save(update_fields=["holiday_last_synced_at", "holiday_last_error", "updated_at"])
        return {
            "skipped": False,
            "year": year,
            "created": created,
            "updated": updated,
            "deleted": deleted,
        }
    except HolidayCalendarError as exc:
        settings.holiday_last_error = str(exc)
        settings.save(update_fields=["holiday_last_error", "updated_at"])
        raise


def sync_enabled_workspaces():
    result = {"synced": 0, "failed": 0, "workspaces": []}
    settings_rows = WorkspaceCalendarSettings.objects.filter(holiday_sync_enabled=True).select_related("workspace")
    for settings in settings_rows.iterator():
        try:
            details = sync_workspace_holidays(settings)
            result["synced"] += 1
            result["workspaces"].append({"workspace_id": str(settings.workspace_id), **details})
        except HolidayCalendarError:
            result["failed"] += 1
    return result
