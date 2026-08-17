/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectWorkItemProperty, TProjectWorkItemPropertyValue } from "@plane/types";
import { Input, TextArea, ToggleSwitch } from "@plane/ui";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
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
      <div className="flex h-7.5 items-center gap-2 px-2">
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
        className={compact ? "min-h-7.5 resize-none px-2 py-1 text-body-xs-regular hover:bg-layer-1" : undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
        onBlur={onBlur}
        disabled={disabled}
        hasError={hasError}
        mode={compact ? "transparent" : "primary"}
        rows={compact ? 1 : undefined}
        textAreaSize={compact ? "xs" : "sm"}
        placeholder="Enter a value"
      />
    );
  }

  if (property.property_type === "DATE" && compact) {
    return (
      <DateDropdown
        value={typeof value === "string" ? value : null}
        onChange={(nextValue) => onChange(nextValue ? (renderFormattedPayloadDate(nextValue) ?? null) : null)}
        onClose={onBlur}
        disabled={disabled}
        placeholder="Enter a value"
        buttonVariant="transparent-with-text"
        className="group h-7.5 w-full grow"
        buttonContainerClassName="h-7.5 w-full text-left"
        buttonClassName="text-body-xs-regular"
        labelClassName={value ? "text-primary" : "text-placeholder"}
        hideIcon
        clearIconClassName="hidden size-3 group-hover:inline"
      />
    );
  }

  return (
    <Input
      className={compact ? "h-7.5 w-full px-2 py-0.5 text-body-xs-regular hover:bg-layer-1" : "w-full"}
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
      mode={compact ? "transparent" : "primary"}
      inputSize={compact ? "xs" : "sm"}
      placeholder="Enter a value"
    />
  );
}
