/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFilterValue } from "../expression";
import type { TTextFilterFieldConfig } from "../field-types";
import { EXTENDED_EQUALITY_OPERATOR } from "../operators";

// ----------------------------- EXACT Operator -----------------------------
export type TExtendedExactOperatorConfigs = never;

// ----------------------------- IN Operator -----------------------------
export type TExtendedInOperatorConfigs = never;

// ----------------------------- RANGE Operator -----------------------------
export type TExtendedRangeOperatorConfigs = never;

// ----------------------------- Extended Operator Specific Configs -----------------------------
export type TExtendedOperatorSpecificConfigs = {
  [EXTENDED_EQUALITY_OPERATOR.CONTAINS]: TTextFilterFieldConfig<TFilterValue>;
};
