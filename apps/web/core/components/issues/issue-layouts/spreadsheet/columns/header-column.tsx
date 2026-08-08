/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

//ui
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckIcon, ChevronDownIcon, Eraser, MoveRight } from "lucide-react";
// constants
import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
// i18n
import { useTranslation } from "@plane/i18n";
// types
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssueOrderByOptions } from "@plane/types";
import { CustomMenu, Row } from "@plane/ui";
import useLocalStorage from "@/hooks/use-local-storage";
import { SpreadSheetPropertyIcon } from "../../utils";

interface Props {
  property: keyof IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  onClose: () => void;
  isEpic?: boolean;
}

export function HeaderColumn(props: Props) {
  const { displayFilters, handleDisplayFilterUpdate, property, onClose, isEpic = false } = props;
  // i18n
  const { t } = useTranslation();
  const { storedValue: selectedMenuItem, setValue: setSelectedMenuItem } = useLocalStorage(
    "spreadsheetViewSorting",
    ""
  );
  const { storedValue: activeSortingProperty, setValue: setActiveSortingProperty } = useLocalStorage(
    "spreadsheetViewActiveSortingProperty",
    ""
  );
  const propertyDetails = SPREADSHEET_PROPERTY_DETAILS[property];

  const handleOrderBy = (order: TIssueOrderByOptions, itemKey: string) => {
    handleDisplayFilterUpdate({ order_by: order });

    setSelectedMenuItem(`${order}_${itemKey}`);
    setActiveSortingProperty(order === "-created_at" ? "" : itemKey);
  };

  if (!propertyDetails) return null;

  return (
    <CustomMenu
      customButtonClassName="clickable !w-full"
      customButtonTabIndex={-1}
      className="!w-full"
      customButton={
        <Row className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden py-2 text-13 text-secondary hover:text-primary">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <SpreadSheetPropertyIcon
              iconKey={propertyDetails.icon}
              className="h-4 w-4 flex-shrink-0 text-placeholder"
            />
            <span className="truncate">
              {property === "sub_issue_count"
                ? isEpic
                  ? t("issue.label", { count: 2 })
                  : t(propertyDetails.i18n_title)
                : t(propertyDetails.i18n_title)}
            </span>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center">
            {activeSortingProperty === property && (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full">
                {propertyDetails.ascendingOrderKey === displayFilters.order_by ? (
                  <ArrowDownWideNarrow className="h-3 w-3" />
                ) : (
                  <ArrowUpNarrowWide className="h-3 w-3" />
                )}
              </div>
            )}
            <ChevronDownIcon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          </div>
        </Row>
      }
      onMenuClose={onClose}
      placement="bottom-start"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.ascendingOrderKey, property)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${propertyDetails.ascendingOrderKey}_${property}`
              ? "text-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowDownWideNarrow className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.descendingOrderTitle}</span>
          </div>

          {selectedMenuItem === `${propertyDetails.ascendingOrderKey}_${property}` && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.descendingOrderKey, property)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${propertyDetails.descendingOrderKey}_${property}`
              ? "text-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowUpNarrowWide className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.descendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
          </div>

          {selectedMenuItem === `${propertyDetails.descendingOrderKey}_${property}` && (
            <CheckIcon className="h-3 w-3" />
          )}
        </div>
      </CustomMenu.MenuItem>
      {selectedMenuItem &&
        selectedMenuItem !== "" &&
        displayFilters?.order_by !== "-created_at" &&
        selectedMenuItem.includes(property) && (
          <CustomMenu.MenuItem
            className={`mt-0.5 ${selectedMenuItem === `-created_at_${property}` ? "bg-layer-1" : ""}`}
            key={property}
            onClick={() => handleOrderBy("-created_at", property)}
          >
            <div className="flex items-center gap-2 px-1">
              <Eraser className="h-3 w-3" />
              <span>{t("common.actions.clear_sorting")}</span>
            </div>
          </CustomMenu.MenuItem>
        )}
    </CustomMenu>
  );
}
