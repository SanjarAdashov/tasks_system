/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  ILayoutDisplayFiltersOptions,
  TIssueGroupByOptions,
} from "@plane/types";
// components
import {
  FilterDisplayProperties,
  FilterExtraOptions,
  FilterGroupBy,
  FilterOrderBy,
  FilterSubGroupBy,
} from "@/components/issues/issue-layouts/filters";
import { useProjectWorkItemFieldVisibility } from "@/hooks/use-project-work-item-field-visibility";

type Props = {
  displayFilters: IIssueDisplayFilterOptions | undefined;
  displayProperties: IIssueDisplayProperties;
  handleDisplayFiltersUpdate: (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => void;
  handleDisplayPropertiesUpdate: (updatedDisplayProperties: Partial<IIssueDisplayProperties>) => void;
  layoutDisplayFiltersOptions: ILayoutDisplayFiltersOptions | undefined;
  ignoreGroupedFilters?: Partial<TIssueGroupByOptions>[];
  cycleViewDisabled?: boolean;
  moduleViewDisabled?: boolean;
  isEpic?: boolean;
};

export const DisplayFiltersSelection = observer(function DisplayFiltersSelection(props: Props) {
  const {
    displayFilters,
    displayProperties,
    handleDisplayFiltersUpdate,
    handleDisplayPropertiesUpdate,
    layoutDisplayFiltersOptions,
    ignoreGroupedFilters = [],
    cycleViewDisabled = false,
    moduleViewDisabled = false,
    isEpic = false,
  } = props;
  const { workspaceSlug, projectId } = useParams();
  const { isDisplayPropertyVisible, isFieldVisible, isGroupByVisible, isOrderByVisible, visibleDisplayProperties } =
    useProjectWorkItemFieldVisibility(workspaceSlug?.toString(), projectId?.toString());

  const effectiveDisplayProperties = visibleDisplayProperties(displayProperties) ?? {};
  const effectiveCycleViewDisabled = cycleViewDisabled || !isFieldVisible("cycle");
  const effectiveModuleViewDisabled = moduleViewDisabled || !isFieldVisible("module");

  React.useEffect(() => {
    const hiddenActiveProperties = Object.entries(displayProperties).filter(
      ([property, isVisible]) => isVisible && !isDisplayPropertyVisible(property as keyof IIssueDisplayProperties)
    );
    if (hiddenActiveProperties.length === 0) return;

    handleDisplayPropertiesUpdate(
      Object.fromEntries(
        hiddenActiveProperties.map(([property]) => [property, false])
      ) as Partial<IIssueDisplayProperties>
    );
  }, [displayProperties, handleDisplayPropertiesUpdate, isDisplayPropertyVisible]);

  React.useEffect(() => {
    const updates: Partial<IIssueDisplayFilterOptions> = {};
    if (!isGroupByVisible(displayFilters?.group_by)) updates.group_by = null;
    if (!isGroupByVisible(displayFilters?.sub_group_by)) updates.sub_group_by = null;
    if (!isOrderByVisible(displayFilters?.order_by)) updates.order_by = "-updated_at";
    if (Object.keys(updates).length > 0) handleDisplayFiltersUpdate(updates);
  }, [displayFilters, handleDisplayFiltersUpdate, isGroupByVisible, isOrderByVisible]);

  const isDisplayFilterEnabled = (displayFilter: keyof IIssueDisplayFilterOptions) =>
    Object.keys(layoutDisplayFiltersOptions?.display_filters ?? {}).includes(displayFilter);

  const computedIgnoreGroupedFilters: Partial<TIssueGroupByOptions>[] = [];
  if (effectiveCycleViewDisabled) computedIgnoreGroupedFilters.push("cycle");
  if (effectiveModuleViewDisabled) computedIgnoreGroupedFilters.push("module");

  return (
    <div className="gts-glass-display-panel vertical-scrollbar relative scrollbar-sm h-full w-full divide-y divide-subtle-1 overflow-hidden overflow-y-auto px-2.5">
      {/* display properties */}
      {layoutDisplayFiltersOptions?.display_properties && layoutDisplayFiltersOptions.display_properties.length > 0 && (
        <div className="py-2">
          <FilterDisplayProperties
            displayProperties={effectiveDisplayProperties}
            displayPropertiesToRender={layoutDisplayFiltersOptions.display_properties}
            handleUpdate={handleDisplayPropertiesUpdate}
            cycleViewDisabled={effectiveCycleViewDisabled}
            moduleViewDisabled={effectiveModuleViewDisabled}
            isEpic={isEpic}
            isPropertyVisible={isDisplayPropertyVisible}
          />
        </div>
      )}

      {/* group by */}
      {isDisplayFilterEnabled("group_by") && (
        <div className="py-2">
          <FilterGroupBy
            displayFilters={displayFilters}
            groupByOptions={layoutDisplayFiltersOptions?.display_filters.group_by ?? []}
            handleUpdate={(val) =>
              handleDisplayFiltersUpdate({
                group_by: val,
              })
            }
            ignoreGroupedFilters={[...ignoreGroupedFilters, ...computedIgnoreGroupedFilters]}
          />
        </div>
      )}

      {/* sub-group by */}
      {isDisplayFilterEnabled("sub_group_by") &&
        displayFilters?.group_by !== null &&
        displayFilters?.layout === "kanban" && (
          <div className="py-2">
            <FilterSubGroupBy
              displayFilters={displayFilters}
              handleUpdate={(val) =>
                handleDisplayFiltersUpdate({
                  sub_group_by: val,
                })
              }
              subGroupByOptions={layoutDisplayFiltersOptions?.display_filters.sub_group_by ?? []}
              ignoreGroupedFilters={[...ignoreGroupedFilters, ...computedIgnoreGroupedFilters]}
            />
          </div>
        )}

      {/* order by */}
      {isDisplayFilterEnabled("order_by") && !isEmpty(layoutDisplayFiltersOptions?.display_filters?.order_by) && (
        <div className="py-2">
          <FilterOrderBy
            selectedOrderBy={displayFilters?.order_by}
            handleUpdate={(val) =>
              handleDisplayFiltersUpdate({
                order_by: val,
              })
            }
            orderByOptions={(layoutDisplayFiltersOptions?.display_filters.order_by ?? []).filter(isOrderByVisible)}
          />
        </div>
      )}

      {/* Options */}
      {layoutDisplayFiltersOptions?.extra_options.access && (
        <div className="py-2">
          <FilterExtraOptions
            selectedExtraOptions={{
              show_empty_groups: displayFilters?.show_empty_groups ?? true,
              sub_issue: displayFilters?.sub_issue ?? true,
            }}
            handleUpdate={(key, val) =>
              handleDisplayFiltersUpdate({
                [key]: val,
              })
            }
            enabledExtraOptions={layoutDisplayFiltersOptions?.extra_options.values}
          />
        </div>
      )}
    </div>
  );
});
