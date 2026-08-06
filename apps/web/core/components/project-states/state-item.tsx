/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { IState, TStateGroups, TStateOperationsCallbacks } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { StateItemTitle, StateUpdate } from "@/components/project-states";
// helpers
type TStateItem = {
  groupKey: TStateGroups;
  groupedStates: Record<string, IState[]>;
  totalStates: number;
  state: IState;
  stateOperationsCallbacks: TStateOperationsCallbacks;
  shouldTrackEvents: boolean;
  disabled?: boolean;
  stateItemClassName?: string;
};

export const StateItem = observer(function StateItem(props: TStateItem) {
  const {
    totalStates,
    state,
    stateOperationsCallbacks,
    shouldTrackEvents,
    disabled = false,
    stateItemClassName,
  } = props;
  // states
  const [updateStateModal, setUpdateStateModal] = useState(false);
  const commonStateItemListProps = {
    stateCount: totalStates,
    state: state,
    setUpdateStateModal: setUpdateStateModal,
  };

  if (updateStateModal)
    return (
      <StateUpdate
        state={state}
        updateStateCallback={stateOperationsCallbacks.updateState}
        shouldTrackEvents={shouldTrackEvents}
        handleClose={() => setUpdateStateModal(false)}
      />
    );

  return (
    <div className={cn("group relative rounded-sm border border-subtle bg-surface-1 px-3.5 py-3", stateItemClassName)}>
      {disabled ? (
        <StateItemTitle {...commonStateItemListProps} disabled />
      ) : (
        <StateItemTitle
          {...commonStateItemListProps}
          disabled={false}
          stateOperationsCallbacks={{
            markStateAsDefault: stateOperationsCallbacks.markStateAsDefault,
            deleteState: stateOperationsCallbacks.deleteState,
          }}
          shouldTrackEvents={shouldTrackEvents}
        />
      )}
    </div>
  );
});
