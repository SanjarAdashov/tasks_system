import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { ProjectAnnouncementsSettings } from "@/components/project/announcements";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
import { ProjectAnnouncementsHeader } from "./header";

function ProjectAnnouncementsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  return (
    <SettingsContentWrapper header={<ProjectAnnouncementsHeader />}>
      <PageHead title={t("project_settings.announcements.heading")} />
      <section className="w-full">
        <SettingsHeading
          title={t("project_settings.announcements.heading")}
          description={t("project_settings.announcements.description")}
        />
        <div className="mt-7">
          <ProjectAnnouncementsSettings workspaceSlug={workspaceSlug} projectId={projectId} />
        </div>
      </section>
    </SettingsContentWrapper>
  );
}

export default observer(ProjectAnnouncementsPage);
