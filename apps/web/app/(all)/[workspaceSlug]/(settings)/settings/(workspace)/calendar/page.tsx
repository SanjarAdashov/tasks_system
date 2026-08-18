import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { WorkspaceCalendarSettings } from "@/components/settings/workspace/calendar-settings";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
import { CalendarWorkspaceSettingsHeader } from "./header";

function CalendarSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" className="h-auto" />;
  return (
    <SettingsContentWrapper header={<CalendarWorkspaceSettingsHeader />}>
      <PageHead title={t("workspace_settings.settings.calendar.heading")} />
      <section className="w-full">
        <SettingsHeading
          title={t("workspace_settings.settings.calendar.heading")}
          description={t("workspace_settings.settings.calendar.description")}
        />
        <div className="mt-7">
          <WorkspaceCalendarSettings workspaceSlug={workspaceSlug} />
        </div>
      </section>
    </SettingsContentWrapper>
  );
}

export default observer(CalendarSettingsPage);
