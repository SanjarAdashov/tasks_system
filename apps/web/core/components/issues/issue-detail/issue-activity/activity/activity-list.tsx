/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { TWorkItemBuiltInFieldKey } from "@plane/types";
// helpers
import { getValidKeysFromObject } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectWorkItemFieldVisibility } from "@/hooks/use-project-work-item-field-visibility";
import { useTimeLineRelationOptions } from "@/components/relations";
// local components
import {
  IssueDefaultActivity,
  IssueNameActivity,
  IssueDescriptionActivity,
  IssueStateActivity,
  IssueAssigneeActivity,
  IssuePriorityActivity,
  IssueEstimateActivity,
  IssueParentActivity,
  IssueRelationActivity,
  IssueStartDateActivity,
  IssueTargetDateActivity,
  IssueCycleActivity,
  IssueModuleActivity,
  IssueLabelActivity,
  IssueLinkActivity,
  IssueAttachmentActivity,
  IssueArchivedAtActivity,
  IssueInboxActivity,
} from "./actions";

type TIssueActivityItem = {
  activityId: string;
  ends: "top" | "bottom" | undefined;
};

const ACTIVITY_FIELD_MAP: Record<string, TWorkItemBuiltInFieldKey> = {
  assignees: "assignees",
  cycles: "cycle",
  description: "description",
  estimate_categories: "estimate",
  estimate_point: "estimate",
  estimate_points: "estimate",
  labels: "labels",
  modules: "module",
  parent: "parent",
  priority: "priority",
  start_date: "start_date",
  state: "state",
  target_date: "target_date",
};

export const IssueActivityItem = observer(function IssueActivityItem(props: TIssueActivityItem) {
  const { activityId, ends } = props;
  const { workspaceSlug, projectId } = useParams();
  // hooks
  const {
    activity: { getActivityById },
    // oxlint-disable-next-line no-empty-pattern
    comment: {},
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  const ISSUE_RELATION_OPTIONS = useTimeLineRelationOptions();
  const { isFieldVisible } = useProjectWorkItemFieldVisibility(
    workspaceSlug?.toString() ?? activity?.workspace_detail?.slug,
    projectId?.toString() ?? activity?.project
  );
  const activityRelations = getValidKeysFromObject(ISSUE_RELATION_OPTIONS);

  const componentDefaultProps = { activityId, ends };

  const activityField = activity?.field;
  const configuredField = activityField ? ACTIVITY_FIELD_MAP[activityField] : undefined;
  if (configuredField && !isFieldVisible(configuredField)) return null;

  switch (activityField) {
    case null: // default issue creation
      return <IssueDefaultActivity {...componentDefaultProps} />;
    case "state":
      return <IssueStateActivity {...componentDefaultProps} showIssue={false} />;
    case "name":
      return <IssueNameActivity {...componentDefaultProps} />;
    case "description":
      return <IssueDescriptionActivity {...componentDefaultProps} showIssue={false} />;
    case "assignees":
      return <IssueAssigneeActivity {...componentDefaultProps} showIssue={false} />;
    case "priority":
      return <IssuePriorityActivity {...componentDefaultProps} showIssue={false} />;
    case "estimate_points":
    case "estimate_categories":
    case "estimate_point" /* This case is to handle all the older recorded activities for estimates. Field changed from  "estimate_point" -> `estimate_${estimate_type}`*/:
      return <IssueEstimateActivity {...componentDefaultProps} showIssue={false} />;
    case "parent":
      return <IssueParentActivity {...componentDefaultProps} showIssue={false} />;
    case activityRelations.find((field) => field === activityField):
      return <IssueRelationActivity {...componentDefaultProps} />;
    case "start_date":
      return <IssueStartDateActivity {...componentDefaultProps} showIssue={false} />;
    case "target_date":
      return <IssueTargetDateActivity {...componentDefaultProps} showIssue={false} />;
    case "cycles":
      return <IssueCycleActivity {...componentDefaultProps} />;
    case "modules":
      return <IssueModuleActivity {...componentDefaultProps} />;
    case "labels":
      return <IssueLabelActivity {...componentDefaultProps} showIssue={false} />;
    case "link":
      return <IssueLinkActivity {...componentDefaultProps} showIssue={false} />;
    case "attachment":
      return <IssueAttachmentActivity {...componentDefaultProps} showIssue={false} />;
    case "archived_at":
      return <IssueArchivedAtActivity {...componentDefaultProps} />;
    case "intake":
    case "inbox":
      return <IssueInboxActivity {...componentDefaultProps} />;
    default:
      return null;
  }
});
