/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Combobox } from "@headlessui/react";
import { CheckIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";

export type TStateOptionProps = {
  projectId: string | null | undefined;
  option: {
    value: string | undefined;
    query: string;
    content: React.ReactNode;
    disabled?: boolean;
    reason?: string;
  };
  selectedValue: string | null | undefined;
  className?: string;
  filterAvailableStateIds?: boolean;
  isForWorkItemCreation?: boolean;
  alwaysAllowStateChange?: boolean;
};

export const StateOption = observer(function StateOption(props: TStateOptionProps) {
  const { option, className = "" } = props;

  return (
    <Combobox.Option
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className={({ active, selected }) =>
        cn(
          className,
          active && !option.disabled && "bg-layer-transparent-hover",
          selected ? "text-primary" : "text-secondary",
          option.disabled && "cursor-not-allowed opacity-50"
        )
      }
      title={option.reason}
    >
      {({ selected }) => (
        <>
          <span className="min-w-0 flex-grow">
            <span className="block truncate">{option.content}</span>
            {option.reason && <span className="mt-0.5 block truncate text-10 text-tertiary">{option.reason}</span>}
          </span>
          {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
        </>
      )}
    </Combobox.Option>
  );
});
