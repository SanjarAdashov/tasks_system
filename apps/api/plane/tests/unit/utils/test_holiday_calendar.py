from calendar import monthrange

import pytest

from plane.db.models import WorkspaceCalendarSettings, WorkspaceHoliday
from plane.utils.holiday_calendar import HolidayCalendarError, parse_my_gov_calendar, sync_workspace_holidays


def calendar_html(year=2026):
    month_names = [
        "Январь",
        "Февраль",
        "Март",
        "Апрель",
        "Май",
        "Июнь",
        "Июль",
        "Август",
        "Сентябрь",
        "Октябрь",
        "Ноябрь",
        "Декабрь",
    ]
    cards = []
    for month, name in enumerate(month_names, start=1):
        buttons = []
        for day in range(1, monthrange(year, month)[1] + 1):
            css = "normal"
            if (month, day) == (1, 1):
                css = "bg-default text-white"
            elif (month, day) == (12, 12):
                css = "border-dashed border-yellow-400"
            elif (month, day) == (12, 31):
                css = "text-red-500 bg-red-50"
            buttons.append(f'<button class="{css}">{day}</button>')
        cards.append(f"<section><div><span>{name}</span></div>{''.join(buttons)}</section>")
    return f"<html><h1>Производственный календарь {year}</h1>{''.join(cards)}</html>"


def test_parse_official_calendar_distinguishes_holiday_day_off_and_workday():
    year, rows = parse_my_gov_calendar(calendar_html())
    keyed = {row.date.isoformat(): row.kind for row in rows}
    assert year == 2026
    assert keyed == {
        "2026-01-01": WorkspaceHoliday.Kind.HOLIDAY,
        "2026-12-12": WorkspaceHoliday.Kind.WORKDAY,
        "2026-12-31": WorkspaceHoliday.Kind.DAY_OFF,
    }


def test_parse_official_calendar_rejects_incomplete_source():
    with pytest.raises(HolidayCalendarError):
        parse_my_gov_calendar("<h1>Производственный календарь 2026</h1>")


@pytest.mark.django_db
def test_sync_preserves_manual_override(workspace):
    settings = WorkspaceCalendarSettings.objects.create(workspace=workspace)
    WorkspaceHoliday.objects.create(
        workspace=workspace,
        date="2026-01-01",
        name="Рабочий день компании",
        kind=WorkspaceHoliday.Kind.WORKDAY,
        source=WorkspaceHoliday.Source.MANUAL,
        is_override=True,
    )

    result = sync_workspace_holidays(settings, html=calendar_html())

    assert result["created"] == 3
    assert WorkspaceHoliday.objects.filter(workspace=workspace, date="2026-01-01").count() == 2
    assert (
        WorkspaceHoliday.objects.get(
            workspace=workspace,
            date="2026-01-01",
            source=WorkspaceHoliday.Source.MANUAL,
        ).kind
        == WorkspaceHoliday.Kind.WORKDAY
    )
