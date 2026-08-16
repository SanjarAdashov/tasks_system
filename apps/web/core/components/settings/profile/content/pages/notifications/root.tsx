/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";
import { EmailSettingsLoader } from "@/components/ui/loader/settings/email";
// services
import { UserService } from "@/services/user.service";
// local imports
import { NotificationsProfileSettingsForm } from "./email-notification-form";
import { TelegramNotificationSettingsForm } from "./telegram-notification-form";

const userService = new UserService();

export const NotificationsProfileSettings = observer(function NotificationsProfileSettings() {
  const { t } = useTranslation();
  // fetching user email notification settings
  const { data, isLoading } = useSWR("CURRENT_USER_EMAIL_NOTIFICATION_SETTINGS", () =>
    userService.currentUserEmailNotificationSettings()
  );
  const {
    data: telegramData,
    isLoading: isTelegramLoading,
    mutate: refreshTelegram,
  } = useSWR("CURRENT_USER_TELEGRAM_NOTIFICATION_SETTINGS", () =>
    userService.currentUserTelegramNotificationSettings()
  );

  if (!data || !telegramData || isLoading || isTelegramLoading) {
    return <EmailSettingsLoader />;
  }

  return (
    <div className="size-full">
      <ProfileSettingsHeading
        title={t("account_settings.notifications.heading")}
        description={t("account_settings.notifications.description")}
      />
      <div className="mt-7 flex flex-col gap-8">
        <section>
          <h3 className="text-subheading mb-3 font-medium text-primary">
            {t("account_settings.notifications.email_heading")}
          </h3>
          <NotificationsProfileSettingsForm data={data} />
        </section>
        <TelegramNotificationSettingsForm data={telegramData} refresh={refreshTelegram} />
      </div>
    </div>
  );
});
