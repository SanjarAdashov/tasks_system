/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import type {
  IIssueDisplayProperties,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  TWorkItemBuiltInFieldKey,
  TWorkItemFilterProperty,
} from "@plane/types";
import { ProjectService } from "@/services/project";

const projectService = new ProjectService();

const DISPLAY_PROPERTY_FIELD_MAP: Partial<Record<keyof IIssueDisplayProperties, TWorkItemBuiltInFieldKey>> = {
  assignee: "assignees",
  cycle: "cycle",
  due_date: "target_date",
  estimate: "estimate",
  labels: "labels",
  modules: "module",
  priority: "priority",
  start_date: "start_date",
  state: "state",
};

const FILTER_PROPERTY_FIELD_MAP: Partial<Record<TWorkItemFilterProperty, TWorkItemBuiltInFieldKey>> = {
  assignee_id: "assignees",
  cycle_id: "cycle",
  label_id: "labels",
  module_id: "module",
  priority: "priority",
  start_date: "start_date",
  state_group: "state",
  state_id: "state",
  target_date: "target_date",
};

const GROUP_BY_FIELD_MAP: Partial<Record<NonNullable<TIssueGroupByOptions>, TWorkItemBuiltInFieldKey>> = {
  assignees: "assignees",
  cycle: "cycle",
  labels: "labels",
  module: "module",
  priority: "priority",
  state: "state",
  "state_detail.group": "state",
  start_date: "start_date",
  target_date: "target_date",
};

const ORDER_BY_FIELD_MAP: Partial<Record<TIssueOrderByOptions, TWorkItemBuiltInFieldKey>> = {
  "-priority": "priority",
  start_date: "start_date",
  target_date: "target_date",
};

export type TProjectWorkItemFieldVisibility = {
  hiddenFieldKeys: TWorkItemBuiltInFieldKey[];
  isLoading: boolean;
  isDisplayPropertyVisible: (property: keyof IIssueDisplayProperties) => boolean;
  isFieldVisible: (field: TWorkItemBuiltInFieldKey) => boolean;
  isFilterPropertyVisible: (property: TWorkItemFilterProperty) => boolean;
  isGroupByVisible: (groupBy: TIssueGroupByOptions | null | undefined) => boolean;
  isOrderByVisible: (orderBy: TIssueOrderByOptions | undefined) => boolean;
  visibleDisplayProperties: (properties: IIssueDisplayProperties | undefined) => IIssueDisplayProperties | undefined;
};

export const useProjectWorkItemFieldVisibility = (
  workspaceSlug: string | undefined,
  projectId: string | undefined
): TProjectWorkItemFieldVisibility => {
  const { data: configuration, isLoading } = useSWR(
    workspaceSlug && projectId ? `WORK_ITEM_FIELD_CONFIGURATION_${workspaceSlug}_${projectId}` : null,
    () => projectService.getWorkItemFieldConfiguration(workspaceSlug as string, projectId as string)
  );

  const hiddenFieldKeys = useMemo(
    () =>
      Object.entries(configuration?.built_in_fields ?? {})
        .filter(([, settings]) => !settings.visible)
        .map(([field]) => field as TWorkItemBuiltInFieldKey),
    [configuration]
  );
  const hiddenFields = useMemo(() => new Set(hiddenFieldKeys), [hiddenFieldKeys]);

  const isFieldVisible = useCallback((field: TWorkItemBuiltInFieldKey) => !hiddenFields.has(field), [hiddenFields]);

  const isDisplayPropertyVisible = useCallback(
    (property: keyof IIssueDisplayProperties) => {
      const field = DISPLAY_PROPERTY_FIELD_MAP[property];
      return field ? isFieldVisible(field) : true;
    },
    [isFieldVisible]
  );

  const isFilterPropertyVisible = useCallback(
    (property: TWorkItemFilterProperty) => {
      const field = FILTER_PROPERTY_FIELD_MAP[property];
      return field ? isFieldVisible(field) : true;
    },
    [isFieldVisible]
  );

  const isGroupByVisible = useCallback(
    (groupBy: TIssueGroupByOptions | null | undefined) => {
      if (!groupBy) return true;
      const field = GROUP_BY_FIELD_MAP[groupBy];
      return field ? isFieldVisible(field) : true;
    },
    [isFieldVisible]
  );

  const isOrderByVisible = useCallback(
    (orderBy: TIssueOrderByOptions | undefined) => {
      if (!orderBy) return true;
      const field = ORDER_BY_FIELD_MAP[orderBy];
      return field ? isFieldVisible(field) : true;
    },
    [isFieldVisible]
  );

  const visibleDisplayProperties = useCallback(
    (properties: IIssueDisplayProperties | undefined) => {
      if (!properties) return properties;
      return Object.fromEntries(
        Object.entries(properties).map(([property, isVisible]) => [
          property,
          isDisplayPropertyVisible(property as keyof IIssueDisplayProperties) ? isVisible : false,
        ])
      ) as IIssueDisplayProperties;
    },
    [isDisplayPropertyVisible]
  );

  return {
    hiddenFieldKeys,
    isLoading,
    isDisplayPropertyVisible,
    isFieldVisible,
    isFilterPropertyVisible,
    isGroupByVisible,
    isOrderByVisible,
    visibleDisplayProperties,
  };
};
