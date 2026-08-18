/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  CalendarSync,
  ChevronDown,
  CircleOff,
  Cloud,
  List,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCalendarConnection, TCalendarPreference } from "@plane/types";
import { EModalWidth, ModalCore } from "@plane/ui";
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";
import { CalendarSelect } from "@/components/calendar/calendar-select";
import calendarService from "@/services/calendar.service";

type CredentialForm = {
  provider: "ICLOUD" | "CALDAV";
  account_email: string;
  account_label: string;
  server_url: string;
  username: string;
  app_password: string;
};

const providers = [
  { provider: "GOOGLE" as const, name: "Google Calendar", color: "#4285F4" },
  { provider: "MICROSOFT" as const, name: "Microsoft Outlook", color: "#0078D4" },
  { provider: "ICLOUD" as const, name: "Apple iCloud", color: "#8B5CF6" },
  { provider: "CALDAV" as const, name: "CalDAV", color: "#22A06B" },
];

const inputClass =
  "h-9 w-full rounded-md border border-subtle bg-surface-1 px-3 text-12 text-primary outline-none focus:border-accent-primary";

function ConnectionCalendars({
  connection,
  onChanged,
}: {
  connection: TCalendarConnection;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: calendars = [],
    isLoading,
    mutate,
  } = useSWR(
    isOpen ? `CALENDAR_CONNECTION_SOURCES_${connection.id}` : null,
    () => calendarService.getConnectionCalendars(connection.id),
    { revalidateOnFocus: false }
  );
  return (
    <div className="basis-full border-t border-subtle pt-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex items-center gap-2 text-10 font-semibold text-secondary hover:text-primary"
      >
        <ChevronDown className={`size-3 transition ${isOpen ? "rotate-180" : ""}`} />
        {t("profile.calendars.calendar_sources")}
      </button>
      {isOpen && (
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {isLoading && <div className="text-10 text-tertiary">{t("common.loading")}</div>}
          {calendars.map((calendar) => (
            <label
              key={calendar.id}
              className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-11 text-primary"
            >
              <input
                type="checkbox"
                checked={calendar.selected}
                onChange={async (event) => {
                  const selected = calendars
                    .filter((item) => (item.id === calendar.id ? event.target.checked : item.selected))
                    .map((item) => item.id);
                  if (selected.length === 0) return;
                  await calendarService.updateConnection(connection.id, { selected_calendars: selected });
                  await mutate(
                    calendars.map((item) => Object.assign({}, item, { selected: selected.includes(item.id) })),
                    false
                  );
                  await onChanged();
                }}
              />
              <span className="truncate">{calendar.name}</span>
              {calendar.primary && (
                <span className="ml-auto text-9 text-tertiary">{t("profile.calendars.primary")}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function CalendarsProfileSettings() {
  const { t, currentLocale } = useTranslation();
  const { data: connections = [], mutate } = useSWR("MY_CALENDAR_CONNECTIONS", () => calendarService.getConnections(), {
    revalidateOnFocus: false,
  });
  const { data: preferences, mutate: mutatePreferences } = useSWR(
    "MY_CALENDAR_PREFERENCES",
    () => calendarService.getPreferences(),
    { revalidateOnFocus: false }
  );
  const [credentialForm, setCredentialForm] = useState<CredentialForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [workingHoursDraft, setWorkingHoursDraft] = useState<TCalendarPreference["working_hours"] | null>(null);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(currentLocale === "uz" ? "uz-UZ" : currentLocale, { weekday: "long" }).format(
          new Date(2026, 0, 5 + index)
        )
      ),
    [currentLocale]
  );

  useEffect(() => {
    if (preferences?.working_hours) setWorkingHoursDraft(preferences.working_hours);
  }, [preferences?.working_hours]);

  const connectOAuth = async (provider: "GOOGLE" | "MICROSOFT") => {
    try {
      const result = await calendarService.getOAuthAuthorizationUrl(provider, window.location.href);
      window.location.assign(result.authorization_url);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("profile.calendars.oauth_error") });
    }
  };

  const saveCredentials = async () => {
    if (!credentialForm) return;
    setIsSaving(true);
    try {
      await calendarService.createConnection({ ...credentialForm, sync_mode: "FULL" });
      setCredentialForm(null);
      await mutate();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error") });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-7">
      <ProfileSettingsHeading title={t("profile.calendars.heading")} description={t("profile.calendars.description")} />
      {preferences && (
        <div className="grid gap-4 rounded-xl border border-subtle bg-surface-1 p-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-11 font-semibold text-primary">{t("profile.calendars.default_view")}</div>
            <CalendarSelect
              value={preferences.default_view}
              onChange={async (value) => {
                await mutatePreferences(calendarService.updatePreferences({ default_view: value }), {
                  optimisticData: { ...preferences, default_view: value },
                  revalidate: false,
                });
              }}
              options={[
                { value: "DAY", label: t("calendar.day"), icon: <CalendarDays className="size-3.5" /> },
                { value: "WEEK", label: t("calendar.week"), icon: <CalendarDays className="size-3.5" /> },
                { value: "MONTH", label: t("calendar.month"), icon: <CalendarDays className="size-3.5" /> },
                { value: "SCHEDULE", label: t("calendar.schedule"), icon: <List className="size-3.5" /> },
              ]}
            />
          </div>
          <label className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-11 text-primary sm:self-end">
            <input
              type="checkbox"
              checked={preferences.show_weekends}
              onChange={async (event) => {
                const value = event.target.checked;
                await mutatePreferences(calendarService.updatePreferences({ show_weekends: value }), {
                  optimisticData: { ...preferences, show_weekends: value },
                  revalidate: false,
                });
              }}
            />
            {t("profile.calendars.show_weekends")}
          </label>
          <label className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-11 text-primary">
            <input
              type="checkbox"
              checked={preferences.email_notifications_enabled}
              onChange={async (event) => {
                const value = event.target.checked;
                await mutatePreferences(calendarService.updatePreferences({ email_notifications_enabled: value }), {
                  optimisticData: { ...preferences, email_notifications_enabled: value },
                  revalidate: false,
                });
              }}
            />
            {t("profile.calendars.email_notifications")}
          </label>
          <label className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-11 text-primary">
            <input
              type="checkbox"
              checked={preferences.in_app_notifications_enabled}
              onChange={async (event) => {
                const value = event.target.checked;
                await mutatePreferences(calendarService.updatePreferences({ in_app_notifications_enabled: value }), {
                  optimisticData: { ...preferences, in_app_notifications_enabled: value },
                  revalidate: false,
                });
              }}
            />
            {t("profile.calendars.in_app_notifications")}
          </label>
        </div>
      )}
      {preferences && workingHoursDraft && (
        <section className="rounded-xl border border-subtle bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
            <div>
              <div className="text-12 font-semibold text-primary">{t("profile.calendars.working_hours")}</div>
              <div className="mt-0.5 text-10 text-secondary">{t("profile.calendars.working_hours_hint")}</div>
            </div>
            <Button
              variant="primary"
              onClick={async () => {
                const saved = await calendarService.updatePreferences({ working_hours: workingHoursDraft });
                await mutatePreferences(saved, false);
              }}
            >
              {t("save")}
            </Button>
          </div>
          <div className="divide-y divide-subtle">
            {weekdays.map((label, index) => {
              const key = String(index + 1);
              const day = workingHoursDraft[key];
              return (
                <div
                  key={key}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[1fr_100px_100px]"
                >
                  <label className="flex items-center gap-2 text-11 font-medium text-primary">
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={(event) =>
                        setWorkingHoursDraft({
                          ...workingHoursDraft,
                          [key]: { ...day, enabled: event.target.checked },
                        })
                      }
                    />
                    <span className="capitalize">{label}</span>
                  </label>
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setWorkingHoursDraft({ ...workingHoursDraft, [key]: { ...day, start: event.target.value } })
                    }
                    className={inputClass}
                  />
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setWorkingHoursDraft({ ...workingHoursDraft, [key]: { ...day, end: event.target.value } })
                    }
                    className={inputClass}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((item) => {
          const connected = connections.filter((connection) => connection.provider === item.provider);
          return (
            <div key={item.provider} className="rounded-xl border border-subtle bg-surface-1 p-4">
              <div className="flex items-center gap-3">
                <div
                  className="grid size-10 place-items-center rounded-xl text-white"
                  style={{ backgroundColor: item.color }}
                >
                  <Cloud className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-13 font-semibold text-primary">{item.name}</div>
                  <div className="mt-0.5 text-10 text-secondary">
                    {connected.length > 0
                      ? t("profile.calendars.connected_count", { count: connected.length })
                      : t("profile.calendars.not_connected")}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    item.provider === "GOOGLE" || item.provider === "MICROSOFT"
                      ? connectOAuth(item.provider)
                      : setCredentialForm({
                          provider: item.provider,
                          account_email: "",
                          account_label: "",
                          server_url: item.provider === "ICLOUD" ? "https://caldav.icloud.com" : "",
                          username: "",
                          app_password: "",
                        })
                  }
                >
                  {t("profile.calendars.connect")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {connections.map((connection: TCalendarConnection) => (
          <div
            key={connection.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-subtle bg-surface-1 p-4"
          >
            <div className="grid size-9 place-items-center rounded-lg bg-accent-primary/10 text-accent-primary">
              <CalendarSync className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-12 font-semibold text-primary">
                {connection.account_label || connection.account_email}
              </div>
              <div className="mt-0.5 text-10 text-secondary">
                {connection.provider} · {connection.status}
              </div>
              {connection.last_error && <div className="mt-1 text-10 text-danger-primary">{connection.last_error}</div>}
            </div>
            <CalendarSelect
              value={connection.sync_mode}
              onChange={async (value) => {
                await calendarService.updateConnection(connection.id, {
                  sync_mode: value,
                });
                await mutate();
              }}
              className="w-56"
              options={[
                { value: "FULL", label: t("profile.calendars.full"), icon: <RefreshCw className="size-3.5" /> },
                {
                  value: "INBOUND_BUSY",
                  label: t("profile.calendars.inbound_busy"),
                  icon: <ArrowDownToLine className="size-3.5" />,
                },
                {
                  value: "OUTBOUND_GTS",
                  label: t("profile.calendars.outbound"),
                  icon: <ArrowUpFromLine className="size-3.5" />,
                },
                {
                  value: "DISABLED",
                  label: t("profile.calendars.disabled"),
                  icon: <CircleOff className="size-3.5" />,
                },
              ]}
              optionsClassName="min-w-64"
            />
            <Button
              variant="ghost"
              prependIcon={<RefreshCw className="size-3" />}
              onClick={async () => {
                await calendarService.resyncConnection(connection.id);
                await mutate();
                setToast({
                  type: TOAST_TYPE.SUCCESS,
                  title: t("common.success"),
                  message: t("profile.calendars.sync_queued"),
                });
              }}
            >
              {t("profile.calendars.refresh")}
            </Button>
            <Button
              variant="ghost"
              prependIcon={<Trash2 className="size-3" />}
              onClick={async () => {
                if (!window.confirm(t("profile.calendars.disconnect_confirm"))) return;
                await calendarService.deleteConnection(connection.id);
                await mutate();
              }}
            >
              {t("profile.calendars.disconnect")}
            </Button>
            <ConnectionCalendars connection={connection} onChanged={() => mutate()} />
          </div>
        ))}
      </div>

      <ModalCore
        isOpen={Boolean(credentialForm)}
        handleClose={() => setCredentialForm(null)}
        width={EModalWidth.LG}
        className="!bg-surface-1"
      >
        {credentialForm && (
          <div className="space-y-4 p-5">
            <div>
              <div className="text-16 font-semibold text-primary">{credentialForm.provider}</div>
              <div className="mt-1 text-11 text-secondary">{t("profile.calendars.credentials_hint")}</div>
            </div>
            <input
              type="email"
              value={credentialForm.account_email}
              onChange={(event) => setCredentialForm({ ...credentialForm, account_email: event.target.value })}
              placeholder="Email"
              className={inputClass}
            />
            <input
              value={credentialForm.account_label}
              onChange={(event) => setCredentialForm({ ...credentialForm, account_label: event.target.value })}
              placeholder={t("profile.calendars.account_label")}
              className={inputClass}
            />
            <input
              type="url"
              value={credentialForm.server_url}
              onChange={(event) => setCredentialForm({ ...credentialForm, server_url: event.target.value })}
              placeholder="CalDAV URL"
              className={inputClass}
            />
            <input
              value={credentialForm.username}
              onChange={(event) => setCredentialForm({ ...credentialForm, username: event.target.value })}
              placeholder={t("profile.calendars.username")}
              className={inputClass}
            />
            <input
              type="password"
              value={credentialForm.app_password}
              onChange={(event) => setCredentialForm({ ...credentialForm, app_password: event.target.value })}
              placeholder={t("profile.calendars.app_password")}
              className={inputClass}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCredentialForm(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={isSaving} onClick={saveCredentials}>
                {t("profile.calendars.connect")}
              </Button>
            </div>
          </div>
        )}
      </ModalCore>
    </div>
  );
}
