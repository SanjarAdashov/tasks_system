/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectWorkItemProperty, TProjectWorkItemPropertyValue } from "@plane/types";
import { Input, TextArea, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
import { WorkItemMultiSelectInput } from "./multi-select-input";

type Props = {
  property: TProjectWorkItemProperty;
  value: TProjectWorkItemPropertyValue | undefined;
  onChange: (value: TProjectWorkItemPropertyValue) => void;
  onBlur?: () => void;
  disabled?: boolean;
  hasError?: boolean;
  compact?: boolean;
};

export function WorkItemPropertyFieldInput(props: Props) {
  const { property, value, onChange, onBlur, disabled = false, hasError = false, compact = false } = props;
  const selectedIds = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const options = property.options.filter((option) => option.archived_at === null || selectedIds.includes(option.id));
  const selectClassName = cn(
    "w-full rounded-md border-[0.5px] bg-layer-2 text-13 outline-none disabled:cursor-not-allowed disabled:opacity-60",
    hasError ? "border-danger-strong" : "border-subtle-1",
    compact ? "px-2 py-1" : "px-3 py-2"
  );

  if (property.property_type === "CHECKBOX") {
    return (
      <div className="flex min-h-7 items-center gap-2">
        <ToggleSwitch value={Boolean(value)} onChange={onChange} disabled={disabled} />
        <span className="text-12 text-secondary">{value ? "Yes" : "No"}</span>
      </div>
    );
  }

  if (property.property_type === "SINGLE_SELECT") {
    return (
      <select
        className={selectClassName}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
        onBlur={onBlur}
        disabled={disabled}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id} disabled={option.archived_at !== null}>
            {option.name}
            {option.archived_at ? " (archived)" : ""}
          </option>
        ))}
      </select>
    );
  }

  if (property.property_type === "MULTI_SELECT") {
    return (
      <WorkItemMultiSelectInput
        source={property.multi_select_source ?? "MANUAL"}
        projectId={property.project}
        manualOptions={options.map((option) => ({
          id: option.id,
          label: option.name,
          archived: option.archived_at !== null,
        }))}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        onClose={onBlur}
        disabled={disabled}
        hasError={hasError}
        compact={compact}
      />
    );
  }

  if (property.property_type === "LONG_TEXT") {
    return (
      <TextArea
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
        onBlur={onBlur}
        disabled={disabled}
        hasError={hasError}
        textAreaSize={compact ? "xs" : "sm"}
        placeholder="Enter a value"
      />
    );
  }

  return (
    <Input
      className="w-full"
      type={property.property_type === "NUMBER" ? "number" : property.property_type === "DATE" ? "date" : "text"}
      value={typeof value === "string" || typeof value === "number" ? value : ""}
      onChange={(event) => {
        if (!event.target.value) {
          onChange(null);
          return;
        }
        onChange(property.property_type === "NUMBER" ? Number(event.target.value) : event.target.value);
      }}
      onBlur={onBlur}
      disabled={disabled}
      hasError={hasError}
      inputSize={compact ? "xs" : "sm"}
      placeholder="Enter a value"
    />
  );
}
