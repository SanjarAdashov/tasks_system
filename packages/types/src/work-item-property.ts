/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TWorkItemBuiltInFieldKey =
  | "project"
  | "title"
  | "description"
  | "state"
  | "priority"
  | "assignees"
  | "labels"
  | "start_date"
  | "target_date"
  | "cycle"
  | "module"
  | "estimate"
  | "parent";

export type TWorkItemBuiltInFieldSettings = {
  visible: boolean;
  required: boolean;
};

export type TProjectWorkItemFieldConfiguration = {
  id: string;
  project: string;
  workspace: string;
  built_in_fields: Record<TWorkItemBuiltInFieldKey, TWorkItemBuiltInFieldSettings>;
  created_at: string;
  updated_at: string;
};

export type TWorkItemPropertyType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "SINGLE_SELECT"
  | "MULTI_SELECT";

export type TWorkItemMultiSelectSource = "MANUAL" | "MEMBERS";

export type TProjectWorkItemPropertyOption = {
  id: string;
  name: string;
  sort_order: number;
  archived_at: string | null;
  is_archived?: boolean;
};

export type TProjectWorkItemPropertyValue = string | number | boolean | string[] | null;

export type TProjectWorkItemProperty = {
  id: string;
  project: string;
  workspace: string;
  name: string;
  description: string;
  property_type: TWorkItemPropertyType;
  multi_select_source: TWorkItemMultiSelectSource;
  is_required: boolean;
  default_value: TProjectWorkItemPropertyValue;
  sort_order: number;
  archived_at: string | null;
  options: TProjectWorkItemPropertyOption[];
  created_at: string;
  updated_at: string;
};

export type TProjectWorkItemPropertyPayload = {
  name: string;
  description?: string;
  property_type: TWorkItemPropertyType;
  multi_select_source?: TWorkItemMultiSelectSource;
  is_required?: boolean;
  default_value?: TProjectWorkItemPropertyValue;
  sort_order?: number;
  options?: Array<
    Pick<TProjectWorkItemPropertyOption, "id" | "name" | "sort_order"> & {
      is_archived?: boolean;
    }
  >;
};
