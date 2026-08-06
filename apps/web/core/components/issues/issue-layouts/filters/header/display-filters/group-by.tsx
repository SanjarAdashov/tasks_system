/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { IIssueDisplayFilterOptions, TIssueGroupByOptions } from "@plane/types";
// helpers
import { useGroupByOptions } from "../../../utils";
// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
import { useProjectWorkItemProperties } from "@/components/issues/work-item-properties/use-project-work-item-properties";

type Props = {
  displayFilters: IIssueDisplayFilterOptions | undefined;
  groupByOptions: TIssueGroupByOptions[];
  handleUpdate: (val: TIssueGroupByOptions) => void;
  ignoreGroupedFilters: Partial<TIssueGroupByOptions>[];
};

export const FilterGroupBy = observer(function FilterGroupBy(props: Props) {
  const { displayFilters, groupByOptions, handleUpdate, ignoreGroupedFilters } = props;
  // hooks
  const { t } = useTranslation();
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const customProperties = useProjectWorkItemProperties().filter((property) =>
    ["SINGLE_SELECT", "CHECKBOX"].includes(property.property_type)
  );

  const selectedGroupBy = displayFilters?.group_by ?? null;
  const selectedSubGroupBy = displayFilters?.sub_group_by ?? null;

  const options = useGroupByOptions(groupByOptions);

  return (
    <>
      <FilterHeader
        title={t("common.group_by")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {options.map((groupBy) => {
            if (
              displayFilters?.layout === "kanban" &&
              selectedSubGroupBy !== null &&
              groupBy.key === selectedSubGroupBy
            )
              return null;
            if (ignoreGroupedFilters.includes(groupBy?.key)) return null;

            return (
              <FilterOption
                key={groupBy?.key}
                isChecked={selectedGroupBy === groupBy?.key}
                onClick={() => handleUpdate(groupBy.key)}
                title={t(groupBy.titleTranslationKey)}
                multiple={false}
              />
            );
          })}
          {customProperties.map((property) => {
            const key = `customproperty_${property.id}` as TIssueGroupByOptions;
            if (selectedSubGroupBy === key || ignoreGroupedFilters.includes(key)) return null;
            return (
              <FilterOption
                key={key}
                isChecked={selectedGroupBy === key}
                onClick={() => handleUpdate(key)}
                title={property.name}
                multiple={false}
              />
            );
          })}
        </div>
      )}
    </>
  );
});
