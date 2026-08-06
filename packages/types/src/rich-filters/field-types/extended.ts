/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFilterValue } from "../expression";
import type { TBaseFilterFieldConfig } from "./shared";

/**
 * Extended filter types
 */
export const EXTENDED_FILTER_FIELD_TYPE = {
  TEXT: "text",
  NUMBER: "number",
} as const;

export type TTextFilterFieldConfig<V extends TFilterValue> = TBaseFilterFieldConfig & {
  type: typeof EXTENDED_FILTER_FIELD_TYPE.TEXT;
  defaultValue?: V;
  placeholder?: string;
};

export type TNumberFilterFieldConfig<V extends TFilterValue> = TBaseFilterFieldConfig & {
  type: typeof EXTENDED_FILTER_FIELD_TYPE.NUMBER;
  defaultValue?: V;
  placeholder?: string;
};

// -------- UNION TYPES --------

/**
 * All extended filter configurations
 */
export type TExtendedFilterFieldConfigs<V extends TFilterValue = TFilterValue> =
  | TTextFilterFieldConfig<V>
  | TNumberFilterFieldConfig<V>;
