/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkItemBuiltInFieldKey, TWorkItemPropertyType } from "@plane/types";

export const BUILT_IN_FIELD_ORDER: TWorkItemBuiltInFieldKey[] = [
  "project",
  "title",
  "description",
  "state",
  "priority",
  "assignees",
  "labels",
  "start_date",
  "target_date",
  "cycle",
  "module",
  "estimate",
  "parent",
];

export const BUILT_IN_FIELD_LABELS: Record<TWorkItemBuiltInFieldKey, string> = {
  project: "Project",
  title: "Title",
  description: "Description",
  state: "State",
  priority: "Priority",
  assignees: "Assignees",
  labels: "Labels",
  start_date: "Start date",
  target_date: "Due date",
  cycle: "Cycle",
  module: "Module",
  estimate: "Estimate",
  parent: "Parent work item",
};

export const HIDEABLE_BUILT_IN_FIELDS = new Set<TWorkItemBuiltInFieldKey>([
  "start_date",
  "target_date",
  "cycle",
  "module",
  "estimate",
  "parent",
]);

export const PROPERTY_TYPE_LABELS: Record<TWorkItemPropertyType, string> = {
  SHORT_TEXT: "Short text",
  LONG_TEXT: "Multi-line text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SINGLE_SELECT: "Single select",
  MULTI_SELECT: "Multi-select",
};
