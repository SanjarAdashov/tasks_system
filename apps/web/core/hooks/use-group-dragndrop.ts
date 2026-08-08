/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, TIssue, TIssueGroupByOptions, TIssueOrderByOptions } from "@plane/types";
import type { GroupDropLocation } from "@/components/issues/issue-layouts/utils";
import { handleGroupDragDrop } from "@/components/issues/issue-layouts/utils";
import { ISSUE_FILTER_DEFAULT_DATA } from "@/store/issue/helpers/base-issues.store";
import { useIssueDetail } from "./store/use-issue-detail";
import { useIssues } from "./store/use-issues";
import { useIssuesActions } from "./use-issues-actions";

type DNDStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.ARCHIVED
  | EIssuesStoreType.WORKSPACE_DRAFT
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC
  | EIssuesStoreType.TEAM_PROJECT_WORK_ITEMS;

export const useGroupIssuesDragNDrop = (
  storeType: DNDStoreType,
  orderBy: TIssueOrderByOptions | undefined,
  groupBy: TIssueGroupByOptions | undefined,
  subGroupBy?: TIssueGroupByOptions,
  enableUndo = false
) => {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();

  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { updateIssue } = useIssuesActions(storeType);
  const {
    issues: { getIssueIds, addCycleToIssue, removeCycleFromIssue, changeModulesInIssue },
  } = useIssues(storeType);

  /**
   * update Issue on Drop, checks if modules or cycles are changed and then calls appropriate functions
   * @param projectId
   * @param issueId
   * @param data
   * @param issueUpdates
   */
  const updateIssueOnDrop = async (
    projectId: string,
    issueId: string,
    data: Partial<TIssue>,
    issueUpdates: {
      [groupKey: string]: {
        ADD: string[];
        REMOVE: string[];
      };
    },
    showUndo = enableUndo
  ) => {
    const errorToastProps = {
      type: TOAST_TYPE.ERROR,
      title: "Error!",
      message: "Error while updating work item",
    };
    const issueBeforeUpdate = getIssueById(issueId);
    const originalData = { ...data };
    const moduleKey = ISSUE_FILTER_DEFAULT_DATA["module"];
    const cycleKey = ISSUE_FILTER_DEFAULT_DATA["cycle"];

    const isModuleChanged = Object.keys(data).includes(moduleKey);
    const isCycleChanged = Object.keys(data).includes(cycleKey);

    if (isCycleChanged && workspaceSlug) {
      if (data[cycleKey]) {
        await addCycleToIssue(workspaceSlug.toString(), projectId, data[cycleKey]?.toString() ?? "", issueId);
      } else {
        await removeCycleFromIssue(workspaceSlug.toString(), projectId, issueId);
      }
      delete data[cycleKey];
    }

    if (isModuleChanged && workspaceSlug && issueUpdates[moduleKey]) {
      await changeModulesInIssue(
        workspaceSlug.toString(),
        projectId,
        issueId,
        issueUpdates[moduleKey].ADD,
        issueUpdates[moduleKey].REMOVE
      );
      delete data[moduleKey];
    }

    if (updateIssue) {
      try {
        await updateIssue(projectId, issueId, data);
        if (showUndo && issueBeforeUpdate) {
          const restoreData: Partial<TIssue> = {};
          Object.keys(originalData).forEach((key) => {
            if (key === "property_values") {
              const changedValues = originalData.property_values ?? {};
              restoreData.property_values = Object.fromEntries(
                Object.keys(changedValues).map((propertyId) => [
                  propertyId,
                  issueBeforeUpdate.property_values?.[propertyId] ?? null,
                ])
              );
            } else {
              (restoreData as Record<string, unknown>)[key] = (issueBeforeUpdate as unknown as Record<string, unknown>)[
                key
              ];
            }
          });
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("issue.custom_grouping.toast.moved"),
            actionItems: createElement(
              "button",
              {
                type: "button",
                className: "rounded px-2 py-1 text-11 font-medium text-accent-primary hover:bg-layer-2",
                onClick: () => {
                  const reversedUpdates = Object.fromEntries(
                    Object.entries(issueUpdates).map(([key, value]) => [key, { ADD: value.REMOVE, REMOVE: value.ADD }])
                  );
                  void updateIssueOnDrop(projectId, issueId, restoreData, reversedUpdates, false);
                },
              },
              t("common.undo")
            ),
          });
        }
      } catch (error: any) {
        setToast({
          ...errorToastProps,
          message:
            error?.state_transition?.reasons?.join(" ") ?? error?.state_transition?.message ?? errorToastProps.message,
        });
        error.__groupDropHandled = true;
        throw error;
      }
    }
  };

  const handleOnDrop = async (source: GroupDropLocation, destination: GroupDropLocation) => {
    if (
      source.columnId &&
      destination.columnId &&
      destination.columnId === source.columnId &&
      destination.id === source.id
    )
      return;

    await handleGroupDragDrop(
      source,
      destination,
      getIssueById,
      getIssueIds,
      updateIssueOnDrop,
      groupBy,
      subGroupBy,
      orderBy !== "sort_order"
    ).catch((err) => {
      if (!err?.__groupDropHandled)
        setToast({
          title: "Error!",
          type: TOAST_TYPE.ERROR,
          message: err?.detail ?? "Failed to perform this action",
        });
      throw err;
    });
  };

  return handleOnDrop;
};
