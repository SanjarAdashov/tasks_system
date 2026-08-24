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
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Cloud,
  ExternalLink,
  KeyRound,
  List,
  Mail,
  RefreshCw,
  ShieldCheck,
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

const ICLOUD_SERVER_URL = "https://caldav.icloud.com";
const APPLE_ACCOUNT_URL = "https://account.apple.com/";
const isValidEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const connectionStatusKey: Record<TCalendarConnection["status"], string> = {
  CONNECTED: "profile.calendars.status_connected",
  PARTIAL: "profile.calendars.status_partial",
  PAUSED: "profile.calendars.status_paused",
  ERROR: "profile.calendars.status_error",
};

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
                disabled={calendar.managed_by_gts}
                onChange={async (event) => {
                  const selected = calendars
                    .filter(
                      (item) => !item.managed_by_gts && (item.id === calendar.id ? event.target.checked : item.selected)
                    )
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
              {calendar.managed_by_gts && (
                <span className="ml-auto text-9 text-accent-primary">{t("profile.calendars.gts_managed")}</span>
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showAdvancedICloud, setShowAdvancedICloud] = useState(false);
  const [syncingConnectionIds, setSyncingConnectionIds] = useState<string[]>([]);
  const [settingTargetIds, setSettingTargetIds] = useState<string[]>([]);
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
    const isICloud = credentialForm.provider === "ICLOUD";
    const accountEmail = credentialForm.account_email.trim();
    const payload = isICloud
      ? {
          provider: "ICLOUD",
          account_email: accountEmail,
          account_label: credentialForm.account_label.trim() || t("profile.calendars.icloud_default_label"),
          server_url: ICLOUD_SERVER_URL,
          username: accountEmail,
          app_password: credentialForm.app_password,
          sync_mode: "FULL",
        }
      : { ...credentialForm, sync_mode: "FULL" };
    setConnectionError(null);
    setIsSaving(true);
    try {
      await calendarService.createConnection(payload);
      setCredentialForm(null);
      await mutate();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.success"),
        message: t(isICloud ? "profile.calendars.icloud_connected" : "profile.calendars.calendar_connected"),
      });
    } catch {
      const message = t(
        isICloud ? "profile.calendars.icloud_connection_error" : "profile.calendars.calendar_connection_error"
      );
      setConnectionError(message);
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message });
    } finally {
      setIsSaving(false);
    }
  };

  const openCredentialForm = (provider: "ICLOUD" | "CALDAV") => {
    setConnectionError(null);
    setShowAdvancedICloud(false);
    setCredentialForm({
      provider,
      account_email: "",
      account_label: "",
      server_url: provider === "ICLOUD" ? ICLOUD_SERVER_URL : "",
      username: "",
      app_password: "",
    });
  };

  const closeCredentialForm = () => {
    if (isSaving) return;
    setCredentialForm(null);
    setConnectionError(null);
    setShowAdvancedICloud(false);
  };

  const resyncConnection = async (connectionId: string) => {
    setSyncingConnectionIds((current) => [...current, connectionId]);
    try {
      const { queued_at: queuedAt } = await calendarService.resyncConnection(connectionId);
      await mutate();
      setToast({
        type: TOAST_TYPE.INFO,
        title: t("profile.calendars.sync_started"),
        message: t("profile.calendars.sync_queued"),
      });
      const queuedAtTime = new Date(queuedAt).getTime();
      const waitForResult = async (attemptsRemaining: number): Promise<TCalendarConnection | null> => {
        if (attemptsRemaining <= 0) return null;
        await wait(2000);
        const latestConnections = await calendarService.getConnections();
        await mutate(latestConnections, false);
        const connection = latestConnections.find((item) => item.id === connectionId);
        if (!connection) return null;
        const completedAt = Math.max(
          connection.last_synced_at ? new Date(connection.last_synced_at).getTime() : 0,
          connection.last_error_at ? new Date(connection.last_error_at).getTime() : 0
        );
        return completedAt >= queuedAtTime ? connection : waitForResult(attemptsRemaining - 1);
      };
      const connection = await waitForResult(30);
      if (connection?.status === "ERROR") {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("profile.calendars.sync_failed"),
          message: connection.last_error || t("profile.calendars.sync_failed_hint"),
        });
      } else if (connection?.status === "PARTIAL") {
        setToast({
          type: TOAST_TYPE.WARNING,
          title: t("profile.calendars.sync_partial"),
          message: t("profile.calendars.sync_partial_hint"),
        });
      } else if (connection) {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("common.success"),
          message: t("profile.calendars.sync_complete"),
        });
      } else
        setToast({
          type: TOAST_TYPE.INFO,
          title: t("profile.calendars.sync_still_running"),
          message: t("profile.calendars.sync_still_running_hint"),
        });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("profile.calendars.sync_failed"),
        message: t("profile.calendars.sync_failed_hint"),
      });
    } finally {
      setSyncingConnectionIds((current) => current.filter((id) => id !== connectionId));
    }
  };

  const setGtsTarget = async (connection: TCalendarConnection) => {
    if (!window.confirm(t("profile.calendars.gts_target_confirm"))) return;
    setSettingTargetIds((current) => [...current, connection.id]);
    try {
      await calendarService.setGtsCalendarTarget(connection.id);
      await mutate();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.success"),
        message: t("profile.calendars.gts_target_success"),
      });
    } catch (error) {
      const message =
        typeof error === "object" && error && "detail" in error
          ? String((error as { detail?: string }).detail || t("profile.calendars.gts_target_error"))
          : t("profile.calendars.gts_target_error");
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message });
    } finally {
      setSettingTargetIds((current) => current.filter((id) => id !== connection.id));
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
                      : openCredentialForm(item.provider)
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
                {connection.provider} · {t(connectionStatusKey[connection.status])}
              </div>
              {connection.last_error && (
                <div
                  className={`mt-1 text-10 ${connection.status === "PARTIAL" ? "text-warning-primary" : "text-danger-primary"}`}
                >
                  {connection.status === "PARTIAL" ? t("profile.calendars.sync_partial_hint") : connection.last_error}
                </div>
              )}
            </div>
            <div className="basis-full rounded-lg border border-subtle bg-surface-2 px-3 py-2.5 sm:order-last">
              <div className="flex flex-wrap items-center gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-primary/10 text-accent-primary">
                  <CalendarDays className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-11 font-semibold text-primary">
                    {connection.is_gts_target
                      ? t("profile.calendars.gts_target_active")
                      : t("profile.calendars.gts_target_title")}
                  </div>
                  <div className="mt-0.5 text-10 text-secondary">
                    {connection.is_gts_target
                      ? t("profile.calendars.gts_target_active_hint")
                      : t("profile.calendars.gts_target_hint")}
                  </div>
                  {connection.gts_calendar_last_error && (
                    <div className="mt-1 text-10 text-danger-primary">{connection.gts_calendar_last_error}</div>
                  )}
                </div>
                {connection.is_gts_target ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-success-primary/10 px-2.5 py-1 text-10 font-semibold text-success-primary">
                    <CheckCircle2 className="size-3.5" />
                    {t("profile.calendars.gts_target_selected")}
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    loading={settingTargetIds.includes(connection.id)}
                    disabled={settingTargetIds.includes(connection.id)}
                    onClick={() => setGtsTarget(connection)}
                  >
                    {t("profile.calendars.gts_target_action")}
                  </Button>
                )}
              </div>
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
              disabled={syncingConnectionIds.includes(connection.id)}
              loading={syncingConnectionIds.includes(connection.id)}
              onClick={() => resyncConnection(connection.id)}
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
        handleClose={closeCredentialForm}
        width={EModalWidth.LG}
        className="!bg-surface-1"
      >
        {credentialForm?.provider === "ICLOUD" ? (
          <div className="overflow-hidden">
            <div className="border-b border-subtle bg-gradient-to-br from-[#8B5CF6]/[0.12] via-surface-1 to-surface-1 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="shadow-sm grid size-10 shrink-0 place-items-center rounded-xl bg-[#8B5CF6] text-white">
                  <Cloud className="size-5" />
                </div>
                <div>
                  <div className="text-16 font-semibold text-primary">{t("profile.calendars.icloud_title")}</div>
                  <div className="mt-1 max-w-lg text-11 leading-5 text-secondary">
                    {t("profile.calendars.icloud_description")}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-[28px_1fr]">
                <div className="grid size-7 place-items-center rounded-full bg-[#8B5CF6]/15 text-11 font-semibold text-[#8B5CF6]">
                  1
                </div>
                <div>
                  <label htmlFor="icloud-account-email" className="text-11 font-semibold text-primary">
                    {t("profile.calendars.icloud_email_label")}
                  </label>
                  <div className="mt-1 text-10 leading-4 text-secondary">
                    {t("profile.calendars.icloud_email_hint")}
                  </div>
                  <div className="relative mt-2">
                    <Mail className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-tertiary" />
                    <input
                      id="icloud-account-email"
                      type="email"
                      autoComplete="email"
                      value={credentialForm.account_email}
                      onChange={(event) => setCredentialForm({ ...credentialForm, account_email: event.target.value })}
                      placeholder={t("profile.calendars.icloud_email_placeholder")}
                      className={`${inputClass} pl-9`}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[28px_1fr]">
                <div className="grid size-7 place-items-center rounded-full bg-[#8B5CF6]/15 text-11 font-semibold text-[#8B5CF6]">
                  2
                </div>
                <div>
                  <div className="text-11 font-semibold text-primary">
                    {t("profile.calendars.icloud_password_step")}
                  </div>
                  <div className="mt-1 text-10 leading-4 text-secondary">
                    {t("profile.calendars.icloud_password_hint")}
                  </div>
                  <Button
                    variant="secondary"
                    className="mt-2"
                    prependIcon={<ExternalLink className="size-3.5" />}
                    onClick={() => window.open(APPLE_ACCOUNT_URL, "_blank", "noopener,noreferrer")}
                  >
                    {t("profile.calendars.open_apple_account")}
                  </Button>
                  <label htmlFor="icloud-app-password" className="mt-3 block text-10 font-medium text-secondary">
                    {t("profile.calendars.app_password")}
                  </label>
                  <div className="relative mt-1.5">
                    <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-tertiary" />
                    <input
                      id="icloud-app-password"
                      type="password"
                      autoComplete="new-password"
                      value={credentialForm.app_password}
                      onChange={(event) => setCredentialForm({ ...credentialForm, app_password: event.target.value })}
                      placeholder={t("profile.calendars.icloud_password_placeholder")}
                      className={`${inputClass} pl-9`}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/[0.07] p-3">
                <div className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#8B5CF6]" />
                  <div>
                    <div className="text-11 font-semibold text-primary">
                      {t("profile.calendars.icloud_automatic_title")}
                    </div>
                    <div className="mt-0.5 text-10 leading-4 text-secondary">
                      {t("profile.calendars.icloud_automatic_description")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-subtle">
                <button
                  type="button"
                  aria-expanded={showAdvancedICloud}
                  onClick={() => setShowAdvancedICloud((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-10 font-semibold text-secondary hover:text-primary"
                >
                  {t("profile.calendars.advanced_settings")}
                  <ChevronDown className={`size-3.5 transition ${showAdvancedICloud ? "rotate-180" : ""}`} />
                </button>
                {showAdvancedICloud && (
                  <div className="grid gap-3 border-t border-subtle p-3 sm:grid-cols-2">
                    <label className="text-10 font-medium text-secondary">
                      {t("profile.calendars.account_label")}
                      <input
                        value={credentialForm.account_label}
                        onChange={(event) =>
                          setCredentialForm({ ...credentialForm, account_label: event.target.value })
                        }
                        placeholder={t("profile.calendars.icloud_default_label")}
                        className={`${inputClass} mt-1.5`}
                      />
                    </label>
                    <label className="text-10 font-medium text-secondary">
                      {t("profile.calendars.caldav_server")}
                      <input
                        readOnly
                        value={ICLOUD_SERVER_URL}
                        className={`${inputClass} mt-1.5 cursor-default bg-surface-2 text-secondary`}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2 text-10 leading-4 text-tertiary">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                {t("profile.calendars.credentials_hint")}
              </div>

              {connectionError && (
                <div role="alert" className="rounded-lg bg-danger-primary/10 px-3 py-2 text-10 text-danger-primary">
                  {connectionError}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                <Button variant="secondary" disabled={isSaving} onClick={closeCredentialForm}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  loading={isSaving}
                  disabled={!isValidEmail(credentialForm.account_email) || !credentialForm.app_password.trim()}
                  onClick={saveCredentials}
                >
                  {t("profile.calendars.connect_icloud")}
                </Button>
              </div>
            </div>
          </div>
        ) : credentialForm ? (
          <div className="space-y-4 p-5">
            <div>
              <div className="text-16 font-semibold text-primary">{t("profile.calendars.caldav_title")}</div>
              <div className="mt-1 text-11 text-secondary">{t("profile.calendars.caldav_description")}</div>
            </div>
            <label className="block text-10 font-medium text-secondary">
              {t("profile.calendars.icloud_email_label")}
              <input
                type="email"
                value={credentialForm.account_email}
                onChange={(event) => setCredentialForm({ ...credentialForm, account_email: event.target.value })}
                placeholder={t("profile.calendars.icloud_email_placeholder")}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block text-10 font-medium text-secondary">
              {t("profile.calendars.account_label")}
              <input
                value={credentialForm.account_label}
                onChange={(event) => setCredentialForm({ ...credentialForm, account_label: event.target.value })}
                placeholder={t("profile.calendars.account_label")}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block text-10 font-medium text-secondary">
              {t("profile.calendars.caldav_server")}
              <input
                type="url"
                value={credentialForm.server_url}
                onChange={(event) => setCredentialForm({ ...credentialForm, server_url: event.target.value })}
                placeholder="https://calendar.example.com/caldav/"
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block text-10 font-medium text-secondary">
              {t("profile.calendars.username")}
              <input
                value={credentialForm.username}
                onChange={(event) => setCredentialForm({ ...credentialForm, username: event.target.value })}
                placeholder={t("profile.calendars.username")}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block text-10 font-medium text-secondary">
              {t("profile.calendars.app_password")}
              <input
                type="password"
                value={credentialForm.app_password}
                onChange={(event) => setCredentialForm({ ...credentialForm, app_password: event.target.value })}
                placeholder={t("profile.calendars.app_password")}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            {connectionError && (
              <div role="alert" className="rounded-lg bg-danger-primary/10 px-3 py-2 text-10 text-danger-primary">
                {connectionError}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-subtle pt-4">
              <Button variant="secondary" disabled={isSaving} onClick={closeCredentialForm}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                loading={isSaving}
                disabled={
                  !isValidEmail(credentialForm.account_email) ||
                  !credentialForm.server_url.trim() ||
                  !credentialForm.username.trim() ||
                  !credentialForm.app_password.trim()
                }
                onClick={saveCredentials}
              >
                {t("profile.calendars.connect")}
              </Button>
            </div>
          </div>
        ) : null}
      </ModalCore>
    </div>
  );
}
