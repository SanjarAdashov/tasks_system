/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssuePropertyValues, TProjectWorkItemProperty, TProjectWorkItemPropertyValue } from "@plane/types";
import { Loader } from "@plane/ui";
import { WorkItemPropertyFieldInput } from "./field-input";

type Props = {
  properties: TProjectWorkItemProperty[];
  values: TIssuePropertyValues;
  errors: Record<string, string>;
  isLoading: boolean;
  onChange: (propertyId: string, value: TProjectWorkItemPropertyValue) => void;
};

export const buildDefaultPropertyValues = (
  properties: TProjectWorkItemProperty[],
  source: TIssuePropertyValues = {}
): TIssuePropertyValues =>
  Object.fromEntries(
    properties.flatMap((property) => {
      const sourceValue = source[property.id];
      if (sourceValue !== undefined && sourceValue !== null) return [[property.id, sourceValue]];
      if (property.default_value !== null) return [[property.id, property.default_value]];
      return [];
    })
  );

export function WorkItemPropertyFormFields(props: Props) {
  const { properties, values, errors, isLoading, onChange } = props;

  if (isLoading) {
    return (
      <Loader className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Loader.Item height="58px" width="100%" />
        <Loader.Item height="58px" width="100%" />
      </Loader>
    );
  }

  if (properties.length === 0) return null;

  return (
    <div className="border-t border-subtle pt-3">
      <div className="mb-3 text-12 font-medium text-secondary">Custom properties</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {properties.map((property) => (
          <label key={property.id} className="flex min-w-0 flex-col gap-1.5 text-11 font-medium text-secondary">
            <span className="truncate">
              {property.name}
              {property.is_required && <span className="ml-0.5 text-danger-primary">*</span>}
            </span>
            <WorkItemPropertyFieldInput
              property={property}
              value={values[property.id] as TProjectWorkItemPropertyValue | undefined}
              onChange={(value) => onChange(property.id, value)}
              hasError={Boolean(errors[property.id])}
            />
            {errors[property.id] && <span className="text-11 text-danger-primary">{errors[property.id]}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
