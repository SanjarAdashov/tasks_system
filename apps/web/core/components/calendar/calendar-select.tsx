/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ReactNode } from "react";
import { CustomSelect } from "@plane/ui";
import { cn } from "@plane/utils";

export type TCalendarSelectOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
};

type Props<TValue extends string> = {
  value: TValue;
  options: TCalendarSelectOption<TValue>[];
  onChange: (value: TValue) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  optionsClassName?: string;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
};

export function CalendarSelect<TValue extends string>({
  value,
  options,
  onChange,
  placeholder = "—",
  disabled = false,
  className,
  buttonClassName,
  optionsClassName,
  placement = "bottom-start",
}: Props<TValue>) {
  const selected = options.find((option) => option.value === value);

  return (
    <CustomSelect
      value={value}
      onChange={(nextValue: TValue) => onChange(nextValue)}
      disabled={disabled}
      label={
        <span className={cn("flex min-w-0 items-center gap-2", !selected && "text-tertiary")}>
          {selected?.icon && <span className="grid size-4 flex-shrink-0 place-items-center">{selected.icon}</span>}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
      }
      input
      placement={placement}
      maxHeight="lg"
      className={cn("w-full", className)}
      buttonClassName={cn(
        "focus-visible:border-accent-primary focus-visible:ring-accent-primary/15 h-9 rounded-md border-subtle bg-surface-1 px-3 py-0 text-12 text-primary shadow-none transition-colors hover:bg-layer-1 focus-visible:ring-2 focus-visible:outline-none",
        disabled && "bg-surface-2 text-tertiary",
        buttonClassName
      )}
      optionsClassName={cn("min-w-56 p-1.5 text-12", optionsClassName)}
    >
      {options.map((option) => (
        <CustomSelect.Option key={option.value} value={option.value} className="min-h-8 px-2 py-1.5 text-primary">
          <span className="flex min-w-0 items-center gap-2">
            {option.icon && <span className="grid size-4 flex-shrink-0 place-items-center">{option.icon}</span>}
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block truncate text-10 text-tertiary">{option.description}</span>
              )}
            </span>
          </span>
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
}
