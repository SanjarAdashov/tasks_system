/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TTranslationKeys } from "@plane/i18n";
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

export const BUILT_IN_FIELD_LABELS: Record<TWorkItemBuiltInFieldKey, TTranslationKeys> = {
  project: "project_settings.work_item_fields.system_fields.fields.project",
  title: "project_settings.work_item_fields.system_fields.fields.title",
  description: "project_settings.work_item_fields.system_fields.fields.description",
  state: "project_settings.work_item_fields.system_fields.fields.state",
  priority: "project_settings.work_item_fields.system_fields.fields.priority",
  assignees: "project_settings.work_item_fields.system_fields.fields.assignees",
  labels: "project_settings.work_item_fields.system_fields.fields.labels",
  start_date: "project_settings.work_item_fields.system_fields.fields.start_date",
  target_date: "project_settings.work_item_fields.system_fields.fields.target_date",
  cycle: "project_settings.work_item_fields.system_fields.fields.cycle",
  module: "project_settings.work_item_fields.system_fields.fields.module",
  estimate: "project_settings.work_item_fields.system_fields.fields.estimate",
  parent: "project_settings.work_item_fields.system_fields.fields.parent",
};

export const HIDEABLE_BUILT_IN_FIELDS = new Set<TWorkItemBuiltInFieldKey>([
  "start_date",
  "target_date",
  "cycle",
  "module",
  "estimate",
  "parent",
]);

export const PROPERTY_TYPE_LABELS: Record<TWorkItemPropertyType, TTranslationKeys> = {
  SHORT_TEXT: "project_settings.work_item_fields.property_types.short_text",
  LONG_TEXT: "project_settings.work_item_fields.property_types.long_text",
  NUMBER: "project_settings.work_item_fields.property_types.number",
  DATE: "project_settings.work_item_fields.property_types.date",
  CHECKBOX: "project_settings.work_item_fields.property_types.checkbox",
  SINGLE_SELECT: "project_settings.work_item_fields.property_types.single_select",
  MULTI_SELECT: "project_settings.work_item_fields.property_types.multi_select",
};
