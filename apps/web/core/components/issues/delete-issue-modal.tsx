/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// types
import { PROJECT_ERROR_MESSAGES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TDeDupeIssue, TIssue } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import calendarService from "@/services/calendar.service";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  dataId?: string | null | undefined;
  data?: TIssue | TDeDupeIssue;
  isSubIssue?: boolean;
  onSubmit?: () => Promise<void>;
  isEpic?: boolean;
};

export const DeleteIssueModal = observer(function DeleteIssueModal(props: Props) {
  const { dataId, data, isOpen, handleClose, isSubIssue = false, onSubmit, isEpic = false } = props;
  // states
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelLinkedMeetings, setCancelLinkedMeetings] = useState(true);
  // store hooks
  const { workspaceSlug } = useParams();
  const { issueMap } = useIssues();
  const { getProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();

  const { data: currentUser } = useUser();

  useEffect(() => {
    setIsDeleting(false);
    setCancelLinkedMeetings(true);
  }, [isOpen]);

  // derived values
  const issue = data || (dataId ? issueMap[dataId] : undefined);
  const issueId = issue?.id;
  const projectDetails = getProjectById(issue?.project_id);
  const isIssueCreator = issue?.created_by === currentUser?.id;

  const canPerformProjectAdminActions = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug?.toString(),
    projectDetails?.id
  );

  const authorized = isIssueCreator || canPerformProjectAdminActions;
  const { data: linkedMeetings = [] } = useSWR(
    isOpen && workspaceSlug && issueId ? `ISSUE_MEETINGS_BEFORE_DELETE_${issueId}` : null,
    () => calendarService.getIssueMeetings(workspaceSlug.toString(), issueId!),
    { revalidateOnFocus: false }
  );
  const activeLinkedMeetings = linkedMeetings.filter((meeting) => meeting.status === "PLANNED");

  if (!dataId && !data) return null;

  const onClose = () => {
    setIsDeleting(false);
    handleClose();
  };

  const handleIssueDelete = async () => {
    setIsDeleting(true);

    if (!authorized) {
      setToast({
        title: t(PROJECT_ERROR_MESSAGES.permissionError.i18n_title),
        type: TOAST_TYPE.ERROR,
        message:
          PROJECT_ERROR_MESSAGES.permissionError.i18n_message && t(PROJECT_ERROR_MESSAGES.permissionError.i18n_message),
      });
      onClose();
      return;
    }
    if (onSubmit)
      await (async () => {
        if (cancelLinkedMeetings && activeLinkedMeetings.length > 0) {
          await Promise.all(
            activeLinkedMeetings.map((meeting) =>
              calendarService.cancelMeeting(workspaceSlug.toString(), meeting.id, t("calendar.task_deleted_reason"))
            )
          );
        }
        await onSubmit();
      })()
        .then(() => {
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("common.success"),
            message: t("entity.delete.success", {
              entity: isSubIssue ? t("common.sub_work_item") : isEpic ? t("common.epic") : t("common.work_item"),
            }),
          });
          onClose();
          return undefined;
        })
        .catch((errors) => {
          const isPermissionError =
            errors?.error ===
            `Only admin or creator can delete the ${isSubIssue ? "sub-work item" : isEpic ? "epic" : "work item"}`;
          const currentError = isPermissionError
            ? PROJECT_ERROR_MESSAGES.permissionError
            : PROJECT_ERROR_MESSAGES.issueDeleteError;
          setToast({
            title: t(currentError.i18n_title),
            type: TOAST_TYPE.ERROR,
            message: currentError.i18n_message && t(currentError.i18n_message),
          });
        })
        .finally(() => onClose());
  };

  return (
    <AlertModalCore
      handleClose={onClose}
      handleSubmit={handleIssueDelete}
      isSubmitting={isDeleting}
      isOpen={isOpen}
      title={t("entity.delete.label", { entity: isEpic ? t("common.epic") : t("common.work_item") })}
      content={
        <>
          {/* TODO: Translate here */}
          {`Are you sure you want to delete ${isEpic ? "epic" : "work item"} `}
          <span className="font-medium break-words text-primary">
            {projectDetails?.identifier}-{issue?.sequence_id}
          </span>
          {` ? All of the data related to the ${isEpic ? "epic" : "work item"} will be permanently removed. This action cannot be undone.`}
          {activeLinkedMeetings.length > 0 && (
            <label className="mt-4 flex items-start gap-2 rounded-md border border-subtle bg-surface-2 p-3 text-11 text-secondary">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={cancelLinkedMeetings}
                onChange={(event) => setCancelLinkedMeetings(event.target.checked)}
              />
              <span>{t("calendar.cancel_linked_meetings", { count: activeLinkedMeetings.length })}</span>
            </label>
          )}
        </>
      }
    />
  );
});
