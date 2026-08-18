/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { Check, Globe2, LockKeyhole, UsersRound } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueAccessSummary, TIssueVisibility } from "@plane/types";
import { ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
import { ProjectService } from "@/services/project";

type Props = {
  workspaceSlug: string;
  projectId: string;
  visibility: TIssueVisibility;
  accessGroupIds?: string[];
  accessSummary?: TIssueAccessSummary | null;
  canManage?: boolean;
  parentRestricted?: boolean;
  inheritParentAccess?: boolean;
  compact?: boolean;
  onVisibilityChange?: (visibility: TIssueVisibility) => void;
  onGroupsChange?: (groupIds: string[]) => void;
  onInheritChange?: (inherit: boolean) => void;
};

export function IssueAccessControl(props: Props) {
  const {
    workspaceSlug,
    projectId,
    visibility,
    accessGroupIds = [],
    accessSummary,
    canManage = true,
    parentRestricted = false,
    inheritParentAccess = true,
    compact = false,
    onVisibilityChange,
    onGroupsChange,
    onInheritChange,
  } = props;
  const { t } = useTranslation();
  const projectService = useMemo(() => new ProjectService(), []);
  const isRestricted = visibility === "RESTRICTED";
  const usesInheritedAccess = parentRestricted && inheritParentAccess;
  const { data: groups = [], isLoading } = useSWR(
    isRestricted && canManage && workspaceSlug && projectId
      ? `ISSUE_ACCESS_GROUPS_${workspaceSlug}_${projectId}`
      : null,
    () => projectService.getUserGroups(workspaceSlug, projectId)
  );

  const toggleGroup = (groupId: string) => {
    if (!onGroupsChange) return;
    onGroupsChange(
      accessGroupIds.includes(groupId)
        ? accessGroupIds.filter((currentId) => currentId !== groupId)
        : [...accessGroupIds, groupId]
    );
  };

  return (
    <section className={cn("rounded-lg border border-subtle-1 bg-layer-1/70", compact ? "px-3 py-3" : "px-4 py-3.5")}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 grid size-7 flex-shrink-0 place-items-center rounded-md",
              isRestricted ? "bg-warning-subtle text-warning-primary" : "bg-layer-2 text-secondary"
            )}
          >
            {isRestricted ? <LockKeyhole className="size-4" /> : <Globe2 className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-body-xs-medium text-primary">
              {isRestricted ? t("issue.access.restricted") : t("issue.access.project")}
            </p>
            <p className="mt-0.5 text-caption-sm-regular text-secondary">
              {isRestricted ? t("issue.access.restricted_description") : t("issue.access.project_description")}
            </p>
          </div>
        </div>
        {canManage && onVisibilityChange && (
          <ToggleSwitch
            value={isRestricted}
            onChange={() => onVisibilityChange(isRestricted ? "PROJECT" : "RESTRICTED")}
            disabled={parentRestricted}
            size="sm"
          />
        )}
      </div>

      {isRestricted && (
        <div className="mt-3 border-t border-subtle-1 pt-3">
          {parentRestricted && canManage && onInheritChange && (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-layer-2"
              onClick={() => onInheritChange(!inheritParentAccess)}
            >
              <div>
                <p className="text-body-xs-medium text-primary">{t("issue.access.inherit_parent")}</p>
                <p className="text-caption-sm-regular text-secondary">{t("issue.access.inherit_parent_description")}</p>
              </div>
              <ToggleSwitch value={inheritParentAccess} onChange={() => {}} size="sm" />
            </button>
          )}

          {usesInheritedAccess ? (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-accent-subtle px-3 py-2 text-caption-sm-regular text-accent-primary">
              <Check className="size-3.5 flex-shrink-0" />
              {t("issue.access.inherited_notice")}
            </div>
          ) : (
            <>
              {canManage && onGroupsChange && (
                <div className="mt-1">
                  <div className="mb-2 flex items-center gap-2 text-caption-sm-medium text-secondary">
                    <UsersRound className="size-3.5" />
                    {t("issue.access.allowed_groups")}
                  </div>
                  {isLoading ? (
                    <p className="text-caption-sm-regular text-placeholder">{t("common.loading")}</p>
                  ) : groups.length === 0 ? (
                    <p className="rounded-md border border-dashed border-subtle-1 px-3 py-2 text-caption-sm-regular text-secondary">
                      {t("issue.access.no_groups")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {groups.map((group) => {
                        const isSelected = accessGroupIds.includes(group.id);
                        return (
                          <button
                            type="button"
                            key={group.id}
                            aria-pressed={isSelected}
                            onClick={() => toggleGroup(group.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-caption-sm-medium transition-colors",
                              isSelected
                                ? "border-accent-strong bg-accent-subtle text-accent-primary"
                                : "border-subtle-1 bg-surface-1 text-secondary hover:border-strong-1 hover:text-primary"
                            )}
                          >
                            {isSelected && <Check className="size-3" />}
                            {group.name}
                            <span className="text-placeholder">{group.members.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {accessSummary && (
                <div className="mt-3 space-y-2">
                  {accessSummary.groups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {accessSummary.groups.map((group) => (
                        <span
                          key={group.id}
                          className="rounded-md bg-layer-2 px-2 py-1 text-caption-sm-medium text-secondary"
                        >
                          {group.name} · {group.member_ids.length}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-caption-sm-regular text-secondary">
                    {t("issue.access.people_with_access", { count: accessSummary.users.length })}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function IssueRestrictedBadge({ issueVisibility }: { issueVisibility?: TIssueVisibility }) {
  const { t } = useTranslation();
  if (issueVisibility !== "RESTRICTED") return null;
  return (
    <span
      title={t("issue.access.restricted")}
      aria-label={t("issue.access.restricted")}
      className="inline-flex size-4 flex-shrink-0 items-center justify-center rounded-sm bg-warning-subtle text-warning-primary"
    >
      <LockKeyhole className="size-3" />
    </span>
  );
}
