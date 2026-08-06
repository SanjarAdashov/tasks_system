/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectWorkItemProperty, TProjectWorkItemPropertyValue } from "@plane/types";
import { Input, TextArea, ToggleSwitch } from "@plane/ui";
import { WorkItemMultiSelectInput, WorkItemSingleSelectInput } from "./multi-select-input";

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
      <WorkItemSingleSelectInput
        source={property.select_source ?? "MANUAL"}
        projectId={property.project}
        manualOptions={options.map((option) => ({
          id: option.id,
          label: option.name,
          archived: option.archived_at !== null,
        }))}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
        onClose={onBlur}
        disabled={disabled}
        hasError={hasError}
        compact={compact}
      />
    );
  }

  if (property.property_type === "MULTI_SELECT") {
    return (
      <WorkItemMultiSelectInput
        source={property.select_source ?? "MANUAL"}
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
