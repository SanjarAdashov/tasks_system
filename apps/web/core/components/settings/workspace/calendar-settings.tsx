/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { orderBy } from "lodash-es";
import { format } from "date-fns";
import {
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarOff,
  CloudDownload,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCalendarWorkspaceSettings, TWorkspaceHoliday } from "@plane/types";
import { CalendarSelect } from "@/components/calendar/calendar-select";
import calendarService from "@/services/calendar.service";

type Props = { workspaceSlug: string };

const inputClass =
  "h-9 rounded-md border border-subtle bg-surface-1 px-3 text-12 text-primary outline-none focus:border-accent-primary";

export function WorkspaceCalendarSettings({ workspaceSlug }: Props) {
  const { t, currentLocale } = useTranslation();
  const currentYear = new Date().getFullYear();
  const start = `${currentYear}-01-01`;
  const end = `${currentYear + 1}-12-31`;
  const { data: settings, mutate: mutateSettings } = useSWR(
    workspaceSlug ? `WORKSPACE_CALENDAR_SETTINGS_${workspaceSlug}` : null,
    () => calendarService.getSettings(workspaceSlug),
    { revalidateOnFocus: false }
  );
  const { data: holidays = [], mutate: mutateHolidays } = useSWR(
    workspaceSlug ? `WORKSPACE_HOLIDAYS_${workspaceSlug}_${start}_${end}` : null,
    () => calendarService.listHolidays(workspaceSlug, start, end),
    { revalidateOnFocus: false }
  );
  const [draft, setDraft] = useState<TCalendarWorkspaceSettings | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "", kind: "DAY_OFF" as TWorkspaceHoliday["kind"] });
  const value = draft || settings;

  const sortedHolidays = useMemo(() => orderBy(holidays, ["date", "is_override"], ["asc", "desc"]), [holidays]);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(currentLocale === "uz" ? "uz-UZ" : currentLocale, { weekday: "long" }).format(
          new Date(2026, 0, 5 + index)
        )
      ),
    [currentLocale]
  );

  const saveSettings = async () => {
    if (!value) return;
    setIsWorking(true);
    try {
      const saved = await calendarService.updateSettings(workspaceSlug, {
        country_code: value.country_code,
        working_hours: value.working_hours,
        holiday_sync_enabled: value.holiday_sync_enabled,
        holiday_source_url: value.holiday_source_url,
      });
      setDraft(null);
      await mutateSettings(saved, false);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("toast.success") });
    } finally {
      setIsWorking(false);
    }
  };

  const sync = async () => {
    setIsWorking(true);
    try {
      await calendarService.syncHolidays(workspaceSlug);
      await Promise.all([mutateSettings(), mutateHolidays()]);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("toast.success") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error") });
    } finally {
      setIsWorking(false);
    }
  };

  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name.trim()) return;
    await calendarService.saveHoliday(workspaceSlug, {
      date: newHoliday.date,
      name: newHoliday.name,
      kind: newHoliday.kind,
      source: newHoliday.kind === "WORKDAY" ? "MANUAL" : "CORPORATE",
      is_override: newHoliday.kind === "WORKDAY",
    });
    setNewHoliday({ date: "", name: "", kind: "DAY_OFF" });
    await mutateHolidays();
  };

  const override = async (holiday: TWorkspaceHoliday) => {
    await calendarService.saveHoliday(workspaceSlug, {
      date: holiday.date,
      name: t("workspace_settings.settings.calendar.company_workday"),
      kind: "WORKDAY",
      source: "MANUAL",
      is_override: true,
    });
    await mutateHolidays();
  };

  if (!value) return <div className="py-10 text-12 text-secondary">{t("calendar.loading")}</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-subtle bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-13 font-semibold text-primary">
              <CalendarCheck2 className="size-4 text-accent-primary" />
              {t("workspace_settings.settings.calendar.work_hours")}
            </div>
            <p className="mt-1 text-11 text-secondary">{t("workspace_settings.settings.calendar.work_hours_hint")}</p>
          </div>
          <Button
            variant="primary"
            prependIcon={<Save className="size-4" />}
            loading={isWorking}
            onClick={saveSettings}
          >
            {t("save")}
          </Button>
        </div>
        <div className="divide-y divide-subtle">
          {weekdays.map((label, index) => {
            const key = String(index + 1);
            const day = value.working_hours[key];
            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3 sm:grid-cols-[1fr_100px_100px]"
              >
                <label className="flex items-center gap-3 text-12 font-medium text-primary">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) =>
                      setDraft({
                        ...value,
                        working_hours: { ...value.working_hours, [key]: { ...day, enabled: event.target.checked } },
                      })
                    }
                  />
                  {label}
                </label>
                <input
                  type="time"
                  value={day.start}
                  disabled={!day.enabled}
                  onChange={(event) =>
                    setDraft({
                      ...value,
                      working_hours: { ...value.working_hours, [key]: { ...day, start: event.target.value } },
                    })
                  }
                  className={inputClass}
                />
                <input
                  type="time"
                  value={day.end}
                  disabled={!day.enabled}
                  onChange={(event) =>
                    setDraft({
                      ...value,
                      working_hours: { ...value.working_hours, [key]: { ...day, end: event.target.value } },
                    })
                  }
                  className={inputClass}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-subtle bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-13 font-semibold text-primary">
              <CloudDownload className="size-4 text-accent-primary" />
              {t("workspace_settings.settings.calendar.holidays")}
            </div>
            <p className="mt-1 text-11 text-secondary">{t("workspace_settings.settings.calendar.holidays_hint")}</p>
          </div>
          <Button variant="secondary" prependIcon={<RotateCcw className="size-4" />} loading={isWorking} onClick={sync}>
            {t("workspace_settings.settings.calendar.sync_now")}
          </Button>
        </div>
        <div className="grid gap-3 border-b border-subtle bg-surface-2 p-4 md:grid-cols-[150px_1fr_180px_auto]">
          <input
            type="date"
            value={newHoliday.date}
            onChange={(event) => setNewHoliday((current) => ({ ...current, date: event.target.value }))}
            className={inputClass}
          />
          <input
            value={newHoliday.name}
            onChange={(event) => setNewHoliday((current) => ({ ...current, name: event.target.value }))}
            placeholder={t("workspace_settings.settings.calendar.holiday_name")}
            className={inputClass}
          />
          <CalendarSelect
            value={newHoliday.kind}
            onChange={(holidayKind) => setNewHoliday((current) => ({ ...current, kind: holidayKind }))}
            options={[
              {
                value: "DAY_OFF",
                label: t("calendar.official_holiday"),
                icon: <CalendarOff className="size-3.5" />,
              },
              {
                value: "WORKDAY",
                label: t("calendar.working_override"),
                icon: <BriefcaseBusiness className="size-3.5" />,
              },
            ]}
            optionsClassName="min-w-60"
          />
          <Button variant="primary" prependIcon={<Plus className="size-4" />} onClick={addHoliday}>
            {t("add")}
          </Button>
        </div>
        <div className="max-h-[520px] divide-y divide-subtle overflow-y-auto">
          {sortedHolidays.map((holiday) => (
            <div key={holiday.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="font-mono w-28 flex-shrink-0 text-11 text-secondary">
                {format(new Date(`${holiday.date}T12:00:00`), "dd.MM.yyyy")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-12 font-medium text-primary">{holiday.name}</div>
                <div className="mt-0.5 text-9 font-semibold text-tertiary uppercase">
                  {holiday.source} · {holiday.kind}
                </div>
              </div>
              {holiday.is_override ? (
                <Button
                  variant="ghost"
                  prependIcon={<Trash2 className="size-3" />}
                  onClick={async () => {
                    await calendarService.deleteHoliday(workspaceSlug, holiday.id);
                    await mutateHolidays();
                  }}
                >
                  {t("workspace_settings.settings.calendar.use_source")}
                </Button>
              ) : holiday.source === "MY_GOV" && holiday.kind !== "WORKDAY" ? (
                <Button variant="secondary" onClick={() => override(holiday)}>
                  {t("workspace_settings.settings.calendar.make_workday")}
                </Button>
              ) : holiday.source === "CORPORATE" ? (
                <Button
                  variant="ghost"
                  prependIcon={<Trash2 className="size-3" />}
                  onClick={async () => {
                    await calendarService.deleteHoliday(workspaceSlug, holiday.id);
                    await mutateHolidays();
                  }}
                >
                  {t("delete")}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
