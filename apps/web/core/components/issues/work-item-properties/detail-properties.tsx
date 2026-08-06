/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import useSWR from "swr";
import type { TIssue, TIssuePropertyValues, TProjectWorkItemPropertyValue, TWorkItemPropertyType } from "@plane/types";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { ProjectService } from "@/services/project";
import { WorkItemPropertyFieldInput } from "./field-input";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issue: TIssue;
  isEditable: boolean;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
};

const COMMIT_ON_CHANGE_TYPES = new Set<TWorkItemPropertyType>(["CHECKBOX", "SINGLE_SELECT", "MULTI_SELECT", "DATE"]);

export function IssueCustomProperties(props: Props) {
  const { workspaceSlug, projectId, issueId, issue, isEditable, updateIssue } = props;
  const service = useMemo(() => new ProjectService(), []);
  const { data: properties } = useSWR(`ISSUE_CUSTOM_PROPERTIES_${workspaceSlug}_${projectId}`, () =>
    service.getWorkItemProperties(workspaceSlug, projectId)
  );
  const [values, setValues] = useState<TIssuePropertyValues>(issue.property_values ?? {});
  const [savingPropertyId, setSavingPropertyId] = useState<string | null>(null);

  useEffect(() => {
    setValues(issue.property_values ?? {});
  }, [issue.property_values]);

  const commit = async (propertyId: string, value: TProjectWorkItemPropertyValue) => {
    setSavingPropertyId(propertyId);
    try {
      await updateIssue(workspaceSlug, projectId, issueId, {
        property_values: { [propertyId]: value },
      });
    } finally {
      setSavingPropertyId(null);
    }
  };

  if (!properties?.length) return null;

  return (
    <>
      {properties.map((property) => {
        const value = values[property.id] as TProjectWorkItemPropertyValue | undefined;
        return (
          <SidebarPropertyListItem
            key={property.id}
            icon={ListChecks}
            label={`${property.name}${property.is_required ? " *" : ""}`}
          >
            <div className="w-full px-2">
              <WorkItemPropertyFieldInput
                property={property}
                value={value}
                disabled={!isEditable || savingPropertyId === property.id}
                compact
                onChange={(nextValue) => {
                  setValues((current) => ({ ...current, [property.id]: nextValue }));
                  if (COMMIT_ON_CHANGE_TYPES.has(property.property_type)) {
                    void commit(property.id, nextValue);
                  }
                }}
                onBlur={() => {
                  if (!COMMIT_ON_CHANGE_TYPES.has(property.property_type)) {
                    void commit(property.id, values[property.id] as TProjectWorkItemPropertyValue);
                  }
                }}
              />
            </div>
          </SidebarPropertyListItem>
        );
      })}
    </>
  );
}
