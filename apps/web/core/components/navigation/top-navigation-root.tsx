/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { CakeSlice } from "lucide-react";
import useSWR from "swr";
import { InboxIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { TopNavPowerK } from "@/components/navigation";
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
import { HelpMenuRoot } from "@/components/workspace/sidebar/help-section/root";
import { UserMenuRoot } from "@/components/workspace/sidebar/user-menu-root";
import { WorkspaceMenuRoot } from "@/components/workspace/sidebar/workspace-menu-root";
import { useAppRailPreferences } from "@/hooks/use-navigation-preferences";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { UserService } from "@/services/user.service";

const userService = new UserService();

export const TopNavigationRoot = observer(function TopNavigationRoot() {
  // router
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  const { t } = useTranslation();

  // store hooks
  const { unreadNotificationsCount, getUnreadNotificationsCount } = useWorkspaceNotifications();
  const { preferences } = useAppRailPreferences();

  const showLabel = preferences.displayMode === "icon_with_label";

  // Fetch notification count
  useSWR(
    workspaceSlug ? "WORKSPACE_UNREAD_NOTIFICATION_COUNT" : null,
    workspaceSlug ? () => getUnreadNotificationsCount(workspaceSlug.toString()) : null
  );
  const { data: birthdayGreeting, mutate: mutateBirthdayGreeting } = useSWR(
    "CURRENT_USER_BIRTHDAY_GREETING",
    () => userService.birthdayGreeting(),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const reopenBirthdayGreeting = () => {
    if (!birthdayGreeting?.is_birthday) return;
    void mutateBirthdayGreeting({ ...birthdayGreeting, should_show: true }, false);
  };

  // Calculate notification count
  const isMentionsEnabled = unreadNotificationsCount.mention_unread_notifications_count > 0;
  const totalNotifications = isMentionsEnabled
    ? unreadNotificationsCount.mention_unread_notifications_count
    : unreadNotificationsCount.total_unread_notifications_count;

  return (
    <div
      className={cn("z-[27] flex min-h-10 w-full items-center bg-canvas px-3.5 transition-all duration-300", {
        "px-2": !showLabel,
      })}
    >
      {/* Workspace Menu */}
      <div className="flex-1 shrink-0">
        <WorkspaceMenuRoot variant="top-navigation" />
      </div>
      {/* Power K Search */}
      <div className="shrink-0">
        <TopNavPowerK />
      </div>
      {/* Additional Actions */}
      <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
        {birthdayGreeting?.is_birthday && (
          <Tooltip tooltipContent={t("calendar.open_birthday_greeting")} position="bottom">
            <button
              type="button"
              onClick={reopenBirthdayGreeting}
              aria-label={t("calendar.open_birthday_greeting")}
              className="group focus-visible:outline-accent-primary grid size-8 place-items-center rounded-md text-warning-primary transition-colors hover:bg-warning-subtle focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <CakeSlice className="birthday-cake-sway size-5" strokeWidth={1.8} />
            </button>
          </Tooltip>
        )}
        <Tooltip tooltipContent="Inbox" position="bottom">
          <AppSidebarItem
            variant="link"
            item={{
              href: `/${workspaceSlug?.toString()}/notifications/`,
              icon: (
                <div className="relative">
                  <InboxIcon className="size-5" />
                  {totalNotifications > 0 && (
                    <span className="absolute top-0 right-0 size-2 rounded-full bg-danger-primary" />
                  )}
                </div>
              ),
              isActive: pathname?.includes("/notifications/"),
            }}
          />
        </Tooltip>
        <HelpMenuRoot />
        <div className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1-hover">
          <UserMenuRoot />
        </div>
      </div>
    </div>
  );
});
