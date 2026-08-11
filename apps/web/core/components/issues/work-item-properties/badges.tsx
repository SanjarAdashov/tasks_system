/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import type { TIssue, TProjectWorkItemProperty, TProjectWorkItemPropertyValue } from "@plane/types";
import { cn } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";
import { ProjectService } from "@/services/project";
import { getProjectWorkItemPropertiesSWRKey } from "./swr-key";

type Props = {
  issue: TIssue;
  className?: string;
  maxVisible?: number;
};

const projectService = new ProjectService();

const hasValue = (value: TProjectWorkItemPropertyValue | undefined): boolean =>
  value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);

const formatValue = (
  property: TProjectWorkItemProperty,
  value: TProjectWorkItemPropertyValue | undefined,
  getMemberName: (memberId: string) => string | undefined
): string | null => {
  if (!hasValue(value)) return null;

  if (property.property_type === "CHECKBOX") return value ? "Yes" : "No";

  if (property.property_type === "SINGLE_SELECT" || property.property_type === "MULTI_SELECT") {
    const selectedIds = Array.isArray(value) ? value : [value];
    const optionNames = selectedIds.map((optionId) =>
      property.select_source === "MEMBERS"
        ? (getMemberName(String(optionId)) ?? String(optionId))
        : (property.options.find((option) => option.id === optionId)?.name ?? String(optionId))
    );
    return optionNames.join(", ");
  }

  return String(value).replace(/\s+/g, " ").trim();
};

export const IssuePropertyBadges = observer(function IssuePropertyBadges(props: Props) {
  const { issue, className, maxVisible = 3 } = props;
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  const { getUserDetails } = useMember();
  const hasPropertyValues = Object.values(issue.property_values ?? {}).some(hasValue);
  const { data: properties } = useSWR(
    workspaceSlug && issue.project_id && hasPropertyValues
      ? getProjectWorkItemPropertiesSWRKey(workspaceSlug, issue.project_id)
      : null,
    () => projectService.getWorkItemProperties(workspaceSlug as string, issue.project_id as string)
  );

  const badges = useMemo(
    () =>
      (properties ?? [])
        .map((property) => {
          const formattedValue = formatValue(
            property,
            issue.property_values?.[property.id],
            (memberId) => getUserDetails(memberId)?.display_name
          );
          return formattedValue ? { id: property.id, label: `${property.name}: ${formattedValue}` } : null;
        })
        .filter((badge): badge is { id: string; label: string } => badge !== null),
    [getUserDetails, issue.property_values, properties]
  );

  if (!badges.length) return null;

  const visibleBadges = badges.slice(0, maxVisible);
  const hiddenCount = badges.length - visibleBadges.length;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {visibleBadges.map((badge) => (
        <span
          key={badge.id}
          title={badge.label}
          className="max-w-48 truncate rounded-sm border border-subtle bg-layer-1 px-1.5 py-0.5 text-11 text-secondary"
        >
          {badge.label}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span
          title={badges
            .slice(maxVisible)
            .map((badge) => badge.label)
            .join("\n")}
          className="rounded-sm border border-subtle bg-layer-1 px-1.5 py-0.5 text-11 text-secondary"
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
});
