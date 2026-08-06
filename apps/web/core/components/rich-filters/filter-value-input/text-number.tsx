/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type {
  TFilterConditionNodeForDisplay,
  TFilterProperty,
  TNumberFilterFieldConfig,
  TTextFilterFieldConfig,
} from "@plane/types";
import { cn } from "@plane/utils";
import { COMMON_FILTER_ITEM_BORDER_CLASSNAME } from "../shared";

type Props<P extends TFilterProperty> = {
  config: TTextFilterFieldConfig<string> | TNumberFilterFieldConfig<number>;
  condition: TFilterConditionNodeForDisplay<P, string | number>;
  isDisabled?: boolean;
  inputType: "text" | "number";
  onChange: (value: string | number | null) => void;
};

export const TextNumberFilterValueInput = observer(function TextNumberFilterValueInput<P extends TFilterProperty>(
  props: Props<P>
) {
  const { condition, config, inputType, isDisabled = false, onChange } = props;
  const value = typeof condition.value === "string" || typeof condition.value === "number" ? condition.value : "";

  return (
    <input
      type={inputType}
      value={value}
      placeholder={config.placeholder ?? "Enter value"}
      disabled={isDisabled}
      className={cn(
        "h-full min-w-32 bg-transparent px-2 text-13 text-primary outline-none placeholder:text-placeholder",
        !isDisabled && COMMON_FILTER_ITEM_BORDER_CLASSNAME,
        isDisabled && "cursor-not-allowed text-placeholder"
      )}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue === "") {
          onChange(null);
          return;
        }
        onChange(inputType === "number" ? Number(nextValue) : nextValue);
      }}
    />
  );
});
