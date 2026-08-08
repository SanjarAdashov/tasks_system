/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// constants
import { SPREADSHEET_SELECT_GROUP } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// ui
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
// components
import { cn } from "@plane/utils";
import { MultipleSelectGroupAction } from "@/components/core/multiple-select";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { HeaderColumn } from "./columns/header-column";
import { SpreadsheetHeaderColumn } from "./spreadsheet-header-column";

interface Props {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  canEditProperties: (projectId: string | undefined) => boolean;
  isEstimateEnabled: boolean;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

export const SpreadsheetHeader = observer(function SpreadsheetHeader(props: Props) {
  const {
    displayProperties,
    displayFilters,
    handleDisplayFilterUpdate,
    canEditProperties,
    isEstimateEnabled,
    spreadsheetColumnsList,
    selectionHelpers,
    isEpic = false,
  } = props;
  // router
  const { projectId } = useParams();
  const { t } = useTranslation();
  // derived values
  const isGroupSelectionEmpty = selectionHelpers.isGroupSelected(SPREADSHEET_SELECT_GROUP) === "empty";
  const showIdentifierColumn = !!displayProperties.key;
  // auth
  const canSelectIssues = canEditProperties(projectId?.toString()) && !selectionHelpers.isSelectionDisabled;

  const selectionAction = canSelectIssues ? (
    <div className="mr-1 flex w-3.5 flex-shrink-0 items-center">
      <MultipleSelectGroupAction
        className={cn(
          "pointer-events-none size-3.5 opacity-0 !outline-none group-hover/list-header:pointer-events-auto group-hover/list-header:opacity-100",
          {
            "pointer-events-auto opacity-100": !isGroupSelectionEmpty,
          }
        )}
        groupID={SPREADSHEET_SELECT_GROUP}
        selectionHelpers={selectionHelpers}
      />
    </div>
  ) : null;

  return (
    <thead className="sticky top-0 left-0 z-[12] border-b-[0.5px] border-subtle">
      <tr>
        {showIdentifierColumn && (
          <th
            className="group/list-header left-0 z-[15] h-11 w-56 max-w-56 min-w-56 overflow-hidden border-r-[0.5px] border-subtle bg-layer-1 px-3 text-13 font-medium md:sticky"
            tabIndex={-1}
          >
            <div className="flex h-full w-full items-center gap-1">
              {selectionAction}
              <div className="min-w-0 flex-1">
                <HeaderColumn
                  property="key"
                  displayFilters={displayFilters}
                  handleDisplayFilterUpdate={handleDisplayFilterUpdate}
                  onClose={() => undefined}
                  isEpic={isEpic}
                />
              </div>
            </div>
          </th>
        )}

        <th
          className={cn(
            "group/list-header h-11 min-w-[28rem] border-r-[0.5px] border-subtle bg-layer-1 px-page-x text-left text-13 font-medium",
            {
              "left-0 z-[15] md:sticky": !showIdentifierColumn,
            }
          )}
          tabIndex={-1}
        >
          <div className="flex h-full items-center gap-2">
            {!showIdentifierColumn && selectionAction}
            <span>{t("issue.title.label")}</span>
          </div>
        </th>

        {spreadsheetColumnsList.map((property) => (
          <SpreadsheetHeaderColumn
            key={property}
            property={property}
            displayProperties={displayProperties}
            displayFilters={displayFilters}
            handleDisplayFilterUpdate={handleDisplayFilterUpdate}
            isEstimateEnabled={isEstimateEnabled}
            isEpic={isEpic}
          />
        ))}
      </tr>
    </thead>
  );
});
