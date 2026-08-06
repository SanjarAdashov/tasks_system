/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "@plane/propel/icons";
import type { TWorkItemMultiSelectSource } from "@plane/types";
import { Avatar, MultiSelectDropdown } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";

export type TWorkItemMultiSelectChoice = {
  id: string;
  label: string;
  archived?: boolean;
};

type Props = {
  source: TWorkItemMultiSelectSource;
  projectId: string;
  manualOptions?: TWorkItemMultiSelectChoice[];
  value: string[];
  onChange: (value: string[]) => void;
  onClose?: () => void;
  disabled?: boolean;
  hasError?: boolean;
  compact?: boolean;
  placeholder?: string;
};

export const WorkItemMultiSelectInput = observer(function WorkItemMultiSelectInput(props: Props) {
  const {
    source,
    projectId,
    manualOptions = [],
    value,
    onChange,
    onClose,
    disabled = false,
    hasError = false,
    compact = false,
    placeholder = "Select values",
  } = props;
  const { workspaceSlug } = useParams();
  const {
    getUserDetails,
    project: { fetchProjectMembers, getProjectMemberIds },
  } = useMember();
  const projectMemberIds = getProjectMemberIds(projectId, false);

  useEffect(() => {
    if (!projectMemberIds && workspaceSlug) {
      void fetchProjectMembers(workspaceSlug.toString(), projectId);
    }
  }, [fetchProjectMembers, projectId, projectMemberIds, workspaceSlug]);

  const choices = useMemo<TWorkItemMultiSelectChoice[]>(() => {
    if (source === "MANUAL") {
      return manualOptions.filter((option) => !option.archived || value.includes(option.id));
    }

    const activeMemberIds = (projectMemberIds ?? []).filter(
      (memberId) => getUserDetails(memberId)?.is_active !== false
    );
    const memberIds = [...new Set([...activeMemberIds, ...value])];
    return memberIds.map((memberId) => {
      const member = getUserDetails(memberId);
      return {
        id: memberId,
        label: member?.display_name || memberId,
        archived: !activeMemberIds.includes(memberId),
      };
    });
  }, [getUserDetails, manualOptions, projectMemberIds, source, value]);

  const choiceMap = useMemo(() => new Map(choices.map((choice) => [choice.id, choice])), [choices]);
  const dropdownOptions = useMemo(
    () =>
      choices.map((choice) => ({
        value: choice.label,
        data: {
          id: choice.id,
          label: choice.label,
          archived: choice.archived,
        },
      })),
    [choices]
  );
  const selectedLabels = value.map((id) => choiceMap.get(id)?.label ?? id);
  const selectionSummary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;
  const refreshMembers = () => {
    if (source === "MEMBERS" && workspaceSlug) {
      void fetchProjectMembers(workspaceSlug.toString(), projectId);
    }
  };

  return (
    <MultiSelectDropdown
      value={value}
      onChange={onChange}
      onOpen={refreshMembers}
      onClose={onClose}
      disabled={disabled}
      options={dropdownOptions}
      keyExtractor={(option) => option.data.id}
      queryArray={["label"]}
      inputPlaceholder={source === "MEMBERS" ? "Search project members" : "Search options"}
      buttonContainerClassName="w-full"
      optionsContainerClassName="w-72"
      buttonContent={(isOpen) => (
        <div
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border-[0.5px] bg-layer-2 text-13",
            hasError ? "border-danger-strong" : "border-subtle-1",
            compact ? "min-h-7 px-2 py-1" : "min-h-9 px-3 py-2",
            disabled && "cursor-not-allowed opacity-60"
          )}
        >
          <span className={cn("truncate", selectedLabels.length === 0 ? "text-placeholder" : "text-primary")}>
            {selectionSummary}
          </span>
          <ChevronDownIcon
            className={cn("size-3 shrink-0 text-tertiary transition-transform", isOpen && "rotate-180")}
          />
        </div>
      )}
      renderItem={({ value: choiceId, selected }) => {
        const choice = choiceMap.get(choiceId);
        const member = source === "MEMBERS" ? getUserDetails(choiceId) : undefined;
        return (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {source === "MEMBERS" && (
              <Avatar name={choice?.label} src={getFileURL(member?.avatar_url ?? "")} size="sm" />
            )}
            <span className={cn("flex-1 truncate", choice?.archived && "text-placeholder")}>
              {choice?.label ?? choiceId}
              {choice?.archived ? (source === "MEMBERS" ? " (inactive)" : " (archived)") : ""}
            </span>
            {selected && <CheckIcon className="size-3.5 shrink-0" />}
          </div>
        );
      }}
    />
  );
});
