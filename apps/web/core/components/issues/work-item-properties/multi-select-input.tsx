/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "@plane/propel/icons";
import type { TWorkItemSelectSource } from "@plane/types";
import { Avatar, Dropdown as SingleSelectDropdown, MultiSelectDropdown } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";

export type TWorkItemSelectChoice = {
  id: string;
  label: string;
  archived?: boolean;
};

type TSharedProps = {
  source: TWorkItemSelectSource;
  projectId: string;
  manualOptions?: TWorkItemSelectChoice[];
  onClose?: () => void;
  disabled?: boolean;
  hasError?: boolean;
  compact?: boolean;
  placeholder?: string;
};

type TSingleProps = TSharedProps & {
  value: string | null;
  onChange: (value: string | null) => void;
};

type TMultiProps = TSharedProps & {
  value: string[];
  onChange: (value: string[]) => void;
};

const NONE_OPTION_ID = "__NONE__";

const useWorkItemSelectChoices = (
  source: TWorkItemSelectSource,
  projectId: string,
  manualOptions: TWorkItemSelectChoice[],
  selectedIds: string[]
) => {
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

  const choices = useMemo<TWorkItemSelectChoice[]>(() => {
    if (source === "MANUAL") {
      return manualOptions.filter((option) => !option.archived || selectedIds.includes(option.id));
    }

    const activeMemberIds = (projectMemberIds ?? []).filter(
      (memberId) => getUserDetails(memberId)?.is_active !== false
    );
    const memberIds = [...new Set([...activeMemberIds, ...selectedIds])];
    return memberIds.map((memberId) => {
      const member = getUserDetails(memberId);
      return {
        id: memberId,
        label: member?.display_name || memberId,
        archived: !activeMemberIds.includes(memberId),
      };
    });
  }, [getUserDetails, manualOptions, projectMemberIds, selectedIds, source]);

  const refreshMembers = () => {
    if (source === "MEMBERS" && workspaceSlug) {
      void fetchProjectMembers(workspaceSlug.toString(), projectId);
    }
  };

  return { choices, getUserDetails, refreshMembers };
};

const selectButtonContent = ({
  isOpen,
  label,
  placeholder,
  hasError,
  compact,
  disabled,
}: {
  isOpen: boolean;
  label?: string;
  placeholder: string;
  hasError: boolean;
  compact: boolean;
  disabled: boolean;
}) => (
  <div
    className={cn(
      "flex w-full items-center justify-between gap-2 rounded-md border-[0.5px] bg-layer-2 text-13",
      hasError ? "border-danger-strong" : "border-subtle-1",
      compact ? "min-h-7 px-2 py-1" : "min-h-9 px-3 py-2",
      disabled && "cursor-not-allowed opacity-60"
    )}
  >
    <span className={cn("truncate", label ? "text-primary" : "text-placeholder")}>{label || placeholder}</span>
    <ChevronDownIcon className={cn("size-3 shrink-0 text-tertiary transition-transform", isOpen && "rotate-180")} />
  </div>
);

export const WorkItemSingleSelectInput = observer(function WorkItemSingleSelectInput(props: TSingleProps) {
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
    placeholder = "Select a value",
  } = props;
  const selectedIds = useMemo(() => (value ? [value] : []), [value]);
  const { choices, getUserDetails, refreshMembers } = useWorkItemSelectChoices(
    source,
    projectId,
    manualOptions,
    selectedIds
  );
  const choicesWithNone = useMemo<TWorkItemSelectChoice[]>(
    () => [{ id: NONE_OPTION_ID, label: "None" }, ...choices],
    [choices]
  );
  const choiceMap = useMemo(() => new Map(choicesWithNone.map((choice) => [choice.id, choice])), [choicesWithNone]);
  const dropdownOptions = useMemo(
    () =>
      choicesWithNone.map((choice) => ({
        value: choice.label,
        data: { id: choice.id, label: choice.label, archived: choice.archived },
      })),
    [choicesWithNone]
  );
  const selectedChoice = value ? choiceMap.get(value) : undefined;

  return (
    <SingleSelectDropdown
      value={value || NONE_OPTION_ID}
      onChange={(choiceId) => onChange(choiceId === NONE_OPTION_ID ? null : choiceId)}
      onOpen={refreshMembers}
      onClose={onClose}
      disabled={disabled}
      options={dropdownOptions}
      keyExtractor={(option) => option.data.id}
      queryArray={["label"]}
      inputPlaceholder={source === "MEMBERS" ? "Search project members" : "Search options"}
      buttonContainerClassName="w-full"
      optionsContainerClassName="w-72"
      disableSorting
      buttonContent={(isOpen) =>
        selectButtonContent({
          isOpen,
          label: selectedChoice?.label,
          placeholder,
          hasError,
          compact,
          disabled,
        })
      }
      renderItem={({ value: choiceId, selected }) => {
        const choice = choiceMap.get(choiceId);
        const member = source === "MEMBERS" && choiceId !== NONE_OPTION_ID ? getUserDetails(choiceId) : undefined;
        return (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {source === "MEMBERS" && choiceId !== NONE_OPTION_ID && (
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

export const WorkItemMultiSelectInput = observer(function WorkItemMultiSelectInput(props: TMultiProps) {
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
  const { choices, getUserDetails, refreshMembers } = useWorkItemSelectChoices(source, projectId, manualOptions, value);
  const choiceMap = useMemo(() => new Map(choices.map((choice) => [choice.id, choice])), [choices]);
  const dropdownOptions = useMemo(
    () =>
      choices.map((choice) => ({
        value: choice.label,
        data: { id: choice.id, label: choice.label, archived: choice.archived },
      })),
    [choices]
  );
  const selectedLabels = value.map((id) => choiceMap.get(id)?.label ?? id);
  const selectionSummary = selectedLabels.length <= 2 ? selectedLabels.join(", ") : `${selectedLabels.length} selected`;

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
      buttonContent={(isOpen) =>
        selectButtonContent({
          isOpen,
          label: selectionSummary,
          placeholder,
          hasError,
          compact,
          disabled,
        })
      }
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
