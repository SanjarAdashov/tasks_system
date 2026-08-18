import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { MeetingTypesSettings } from "@/components/project/meeting-types";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
import { MeetingTypesProjectSettingsHeader } from "./header";

function MeetingTypesSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  return (
    <SettingsContentWrapper header={<MeetingTypesProjectSettingsHeader />}>
      <PageHead title={t("project_settings.meeting_types.heading")} />
      <section className="w-full">
        <SettingsHeading
          title={t("project_settings.meeting_types.heading")}
          description={t("project_settings.meeting_types.description")}
        />
        <div className="mt-7">
          <MeetingTypesSettings workspaceSlug={workspaceSlug} projectId={projectId} />
        </div>
      </section>
    </SettingsContentWrapper>
  );
}

export default observer(MeetingTypesSettingsPage);
