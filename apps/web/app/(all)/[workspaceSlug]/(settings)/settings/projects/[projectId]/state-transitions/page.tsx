/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { StateTransitionSettings } from "@/components/project-states/state-transitions";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";
import { StateTransitionsProjectSettingsHeader } from "./header";

function StateTransitionSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { t } = useTranslation();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("project_settings.state_transitions.heading")}`
    : undefined;

  if (workspaceUserInfo && !canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper header={<StateTransitionsProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <section className="w-full">
        <SettingsHeading
          title={t("project_settings.state_transitions.heading")}
          description={t("project_settings.state_transitions.description")}
        />
        <div className="mt-7">
          <StateTransitionSettings workspaceSlug={workspaceSlug} projectId={projectId} />
        </div>
      </section>
    </SettingsContentWrapper>
  );
}

export default observer(StateTransitionSettingsPage);
