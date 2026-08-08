/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { OctagonAlert } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { IWorkspaceMemberInvitation, TOnboardingSteps } from "@plane/types";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
// hooks
import { useUser } from "@/hooks/store/user";
import { useCreationQuotas } from "@/hooks/use-creation-quotas";
// local imports
import { CreateWorkspace } from "./create-workspace";
import { Invitations } from "./invitations";
import { SwitchAccountDropdown } from "./switch-account-dropdown";

export enum ECreateOrJoinWorkspaceViews {
  WORKSPACE_CREATE = "WORKSPACE_CREATE",
  WORKSPACE_JOIN = "WORKSPACE_JOIN",
}

type Props = {
  invitations: IWorkspaceMemberInvitation[];
  totalSteps: number;
  stepChange: (steps: Partial<TOnboardingSteps>) => Promise<void>;
  finishOnboarding: () => Promise<void>;
};

export const CreateOrJoinWorkspaces = observer(function CreateOrJoinWorkspaces(props: Props) {
  const { invitations, stepChange, finishOnboarding } = props;
  // states
  const [currentView, setCurrentView] = useState<ECreateOrJoinWorkspaceViews | null>(null);
  const { t } = useTranslation();
  // store hooks
  const { data: user } = useUser();
  const { data: creationQuotas } = useCreationQuotas();
  // derived values
  const canCreateWorkspace = Boolean(creationQuotas?.workspace.can_create);

  useEffect(() => {
    if (invitations.length > 0) {
      setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN);
    } else {
      setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_CREATE);
    }
  }, [invitations]);

  const handleNextStep = async () => {
    if (!user) return;

    await finishOnboarding();
  };

  return (
    <div className="flex h-full w-full">
      <div className="h-full w-full overflow-auto px-6 py-10 sm:px-7 sm:py-14 md:px-14 lg:px-28">
        <div className="mt-6 flex w-full flex-col items-center justify-center p-8">
          {currentView === ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN ? (
            <Invitations
              invitations={invitations}
              handleNextStep={handleNextStep}
              handleCurrentViewChange={() => setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_CREATE)}
            />
          ) : currentView === ECreateOrJoinWorkspaceViews.WORKSPACE_CREATE ? (
            creationQuotas === undefined ? (
              <div className="flex h-96 w-full items-center justify-center">
                <LogoSpinner />
              </div>
            ) : canCreateWorkspace ? (
              <CreateWorkspace
                stepChange={stepChange}
                user={user ?? undefined}
                invitedWorkspaces={invitations.length}
                handleCurrentViewChange={() => setCurrentView(ECreateOrJoinWorkspaceViews.WORKSPACE_JOIN)}
              />
            ) : (
              <div className="flex h-96 w-full items-center justify-center">
                <div className="mt-4 flex w-full items-start justify-center gap-2.5 rounded-sm border border-accent-strong/20 bg-accent-primary/10 px-6 py-4 text-13 leading-5 text-accent-secondary">
                  <OctagonAlert className="mt-1 size-5 flex-shrink-0" />
                  <span>{t("creation_quotas.workspace_reached")}</span>
                </div>
              </div>
            )
          ) : (
            <div className="flex h-96 w-full items-center justify-center">
              <LogoSpinner />
            </div>
          )}
        </div>
      </div>
      <SwitchAccountDropdown />
    </div>
  );
});
