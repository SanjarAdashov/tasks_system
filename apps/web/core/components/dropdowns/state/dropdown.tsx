/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { TAvailableStateTransition } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { ProjectService } from "@/services/project";
// local imports
import type { TWorkItemStateDropdownBaseProps } from "./base";
import { WorkItemStateDropdownBase } from "./base";

type TWorkItemStateDropdownProps = Omit<
  TWorkItemStateDropdownBaseProps,
  "stateIds" | "getStateById" | "onDropdownOpen" | "isInitializing"
> & {
  allowValidationSelection?: boolean;
  issueId?: string;
  stateIds?: string[];
};

export const StateDropdown = observer(function StateDropdown(props: TWorkItemStateDropdownProps) {
  const {
    allowValidationSelection = false,
    isForWorkItemCreation = false,
    issueId,
    onChange,
    projectId,
    stateIds: propsStateIds,
    ...dropdownProps
  } = props;
  // router params
  const { workspaceSlug } = useParams();
  // states
  const [stateLoader, setStateLoader] = useState(false);
  const [availableTransitions, setAvailableTransitions] = useState<TAvailableStateTransition[]>([]);
  // store hooks
  const { fetchProjectStates, getProjectStateIds, getStateById } = useProjectState();
  // derived values
  const stateIds = propsStateIds ?? getProjectStateIds(projectId);
  const projectService = useMemo(() => new ProjectService(), []);

  // fetch states if not provided
  const onDropdownOpen = async () => {
    if (!workspaceSlug || !projectId) return;
    if (stateIds === undefined || stateIds.length === 0) {
      setStateLoader(true);
      await fetchProjectStates(workspaceSlug.toString(), projectId);
    }
    if (issueId || isForWorkItemCreation) {
      try {
        setAvailableTransitions(
          await projectService.getAvailableStateTransitions(workspaceSlug.toString(), projectId, {
            issue_id: issueId,
            is_creation: isForWorkItemCreation,
          })
        );
      } catch {
        setAvailableTransitions([]);
      }
    }
    setStateLoader(false);
  };

  const transitionByStateId = new Map(availableTransitions.map((transition) => [transition.state_id, transition]));
  const disabledStateIds = availableTransitions
    .filter((transition) => ["transition_forbidden", "transition_not_configured"].includes(transition.code))
    .map((transition) => transition.state_id);
  const stateTransitionReasons = Object.fromEntries(
    availableTransitions
      .filter((transition) => transition.reasons.length > 0)
      .map((transition) => [transition.state_id, transition.reasons.join(" ")])
  );

  const handleChange = (stateId: string) => {
    const transition = transitionByStateId.get(stateId);
    if (!allowValidationSelection && !isForWorkItemCreation && transition?.code === "validation_failed") {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Transition requirements are not met",
        message: transition.reasons.join(" "),
      });
      return;
    }
    onChange(stateId);
  };

  return (
    <WorkItemStateDropdownBase
      {...dropdownProps}
      disabledStateIds={disabledStateIds}
      getStateById={getStateById}
      isInitializing={stateLoader}
      isForWorkItemCreation={isForWorkItemCreation}
      onChange={handleChange}
      projectId={projectId}
      stateTransitionReasons={stateTransitionReasons}
      stateIds={stateIds ?? []}
      onDropdownOpen={onDropdownOpen}
    />
  );
});
