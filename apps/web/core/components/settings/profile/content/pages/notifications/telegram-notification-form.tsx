/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Send, Unplug } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IUserTelegramNotificationPreferences,
  IUserTelegramNotificationSettings,
  TTelegramNotificationCategory,
  TTelegramQuietHours,
} from "@plane/types";
import { Button, ToggleSwitch } from "@plane/ui";
import { SettingsControlItem } from "@/components/settings/control-item";
import { UserService } from "@/services/user.service";

const userService = new UserService();

const CATEGORY_KEYS: TTelegramNotificationCategory[] = [
  "task_assignment",
  "mention",
  "comment",
  "state_change",
  "issue_completed",
  "priority",
  "due_date",
  "property_change",
  "role_change",
  "account_activity",
  "project_announcement",
];

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type Props = {
  data: IUserTelegramNotificationSettings;
  refresh: () => Promise<unknown>;
};

export function TelegramNotificationSettingsForm({ data, refresh }: Props) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(data.preferences);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => setPreferences(data.preferences), [data.preferences]);

  const notifyError = () =>
    setToast({
      title: t("error"),
      message: t("account_settings.notifications.telegram.update_error"),
      type: TOAST_TYPE.ERROR,
    });

  const update = async (patch: Partial<IUserTelegramNotificationPreferences>) => {
    const previous = preferences;
    const next = { ...preferences, ...patch };
    setPreferences(next);
    try {
      const saved = await userService.updateCurrentUserTelegramNotificationSettings(patch);
      setPreferences(saved);
    } catch {
      setPreferences(previous);
      notifyError();
    }
  };

  const connect = async () => {
    setIsConnecting(true);
    try {
      const link = await userService.createCurrentUserTelegramLink();
      window.open(link.url, "_blank", "noopener,noreferrer");
      setToast({
        title: t("account_settings.notifications.telegram.connect_started"),
        message: t("account_settings.notifications.telegram.connect_started_help"),
        type: TOAST_TYPE.SUCCESS,
      });
    } catch {
      notifyError();
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t("account_settings.notifications.telegram.disconnect_confirm"))) return;
    setIsDisconnecting(true);
    try {
      await userService.disconnectCurrentUserTelegram();
      await refresh();
    } catch {
      notifyError();
    } finally {
      setIsDisconnecting(false);
    }
  };

  const updateSchedule = (day: keyof TTelegramQuietHours, patch: Partial<TTelegramQuietHours["1"]>) => {
    const quietHours = {
      ...preferences.quiet_hours,
      [day]: { ...preferences.quiet_hours[day], ...patch },
    };
    void update({ quiet_hours: quietHours });
  };

  const connectionLabel = data.connection
    ? data.connection.telegram_username
      ? `@${data.connection.telegram_username}`
      : data.connection.telegram_first_name
    : "";

  return (
    <div className="rounded-lg border border-subtle-1 bg-surface-1 p-5">
      <div className="flex flex-col gap-4 border-b border-subtle-1 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Send className="size-5 text-[#229ED9]" />
            <h3 className="text-subheading font-medium text-primary">
              {t("account_settings.notifications.telegram.heading")}
            </h3>
          </div>
          <p className="mt-1 text-caption-md-regular text-secondary">
            {t("account_settings.notifications.telegram.description")}
          </p>
          {data.connection && (
            <p className="mt-2 text-caption-md-medium text-success-primary">
              {t("account_settings.notifications.telegram.connected_as", { name: connectionLabel })}
            </p>
          )}
          {!data.configured && (
            <p className="mt-2 text-caption-md-medium text-warning-primary">
              {t("account_settings.notifications.telegram.not_configured")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {data.connection ? (
            <>
              <Button variant="neutral-primary" size="sm" prependIcon={<RefreshCw />} onClick={() => void refresh()}>
                {t("account_settings.notifications.telegram.refresh")}
              </Button>
              <Button
                variant="outline-danger"
                size="sm"
                prependIcon={<Unplug />}
                loading={isDisconnecting}
                onClick={disconnect}
              >
                {t("account_settings.notifications.telegram.disconnect")}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              prependIcon={<ExternalLink />}
              disabled={!data.configured}
              loading={isConnecting}
              onClick={connect}
            >
              {t("account_settings.notifications.telegram.connect")}
            </Button>
          )}
        </div>
      </div>

      <SettingsControlItem
        title={t("account_settings.notifications.telegram.master")}
        description={t("account_settings.notifications.telegram.master_help")}
        control={
          <ToggleSwitch value={preferences.enabled} onChange={(value) => void update({ enabled: value })} size="sm" />
        }
      />

      <div className={!preferences.enabled ? "pointer-events-none opacity-50" : ""}>
        <h4 className="mt-4 border-t border-subtle-1 pt-5 text-body-sm-medium text-primary">
          {t("account_settings.notifications.telegram.categories")}
        </h4>
        {CATEGORY_KEYS.map((category) => (
          <SettingsControlItem
            key={category}
            title={t(`account_settings.notifications.telegram.category.${category}.title`)}
            description={t(`account_settings.notifications.telegram.category.${category}.description`)}
            control={
              <ToggleSwitch
                value={preferences[category]}
                onChange={(value) => void update({ [category]: value })}
                size="sm"
              />
            }
          />
        ))}

        <div className="mt-4 border-t border-subtle-1 pt-5">
          <SettingsControlItem
            title={t("account_settings.notifications.telegram.quiet_hours")}
            description={t("account_settings.notifications.telegram.quiet_hours_help", { timezone: data.timezone })}
            control={
              <ToggleSwitch
                value={preferences.quiet_hours_enabled}
                onChange={(value) => void update({ quiet_hours_enabled: value })}
                size="sm"
              />
            }
          />
          {preferences.quiet_hours_enabled && (
            <div className="mt-2 divide-y divide-subtle-1 rounded-md border border-subtle-1">
              {WEEKDAYS.map((weekday, index) => {
                const day = String(index + 1) as keyof TTelegramQuietHours;
                const schedule = preferences.quiet_hours[day];
                return (
                  <div
                    key={weekday}
                    className="grid grid-cols-[minmax(120px,1fr)_auto_auto_auto] items-center gap-3 p-3"
                  >
                    <span className="text-body-sm-medium text-primary">
                      {t(`account_settings.notifications.telegram.weekday.${weekday}`)}
                    </span>
                    <ToggleSwitch
                      value={schedule.enabled}
                      onChange={(value) => updateSchedule(day, { enabled: value })}
                      size="sm"
                    />
                    <input
                      type="time"
                      className="rounded border border-subtle-1 bg-surface-2 px-2 py-1 text-body-sm-regular text-primary"
                      value={schedule.start}
                      disabled={!schedule.enabled}
                      onChange={(event) => updateSchedule(day, { start: event.target.value })}
                    />
                    <input
                      type="time"
                      className="rounded border border-subtle-1 bg-surface-2 px-2 py-1 text-body-sm-regular text-primary"
                      value={schedule.end}
                      disabled={!schedule.enabled}
                      onChange={(event) => updateSchedule(day, { end: event.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
