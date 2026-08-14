/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useState } from "react";
import { observer } from "mobx-react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueServiceType } from "@plane/types";
import { convertBytesToSize } from "@plane/utils";
import {
  useProjectAttachmentSettings,
  validateProjectAttachment,
} from "@/components/issues/attachment/attachment-utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { useAttachmentOperations } from "./helper";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  issueServiceType: TIssueServiceType;
};

export const IssueAttachmentActionButton = observer(function IssueAttachmentActionButton(props: Props) {
  const { workspaceSlug, projectId, issueId, customButton, disabled = false, issueServiceType } = props;
  // state
  const [isLoading, setIsLoading] = useState(false);
  // store hooks
  const { setLastWidgetAction, fetchActivities } = useIssueDetail(issueServiceType);
  const { t } = useTranslation();
  const { data: attachmentSettings } = useProjectAttachmentSettings(workspaceSlug, projectId);
  // operations
  const { operations: attachmentOperations } = useAttachmentOperations(
    workspaceSlug,
    projectId,
    issueId,
    issueServiceType
  );
  // handlers
  const handleFetchPropertyActivities = useCallback(() => {
    fetchActivities(workspaceSlug, projectId, issueId);
  }, [fetchActivities, workspaceSlug, projectId, issueId]);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (rejectedFiles.length > 0) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: t("attachment.error"),
        });
      }

      const validFiles = acceptedFiles.filter((file) => {
        const validation = validateProjectAttachment(file, attachmentSettings);
        if (validation.valid) return true;

        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message:
            validation.reason === "disabled"
              ? t("attachment.category_disabled", {
                  category: t(`attachment.categories.${validation.category}`),
                })
              : t("attachment.file_size_limit", { size: convertBytesToSize(validation.maxSize) }),
        });
        return false;
      });

      if (validFiles.length === 0 || !workspaceSlug) return;

      setIsLoading(true);
      Promise.all(validFiles.map((file) => attachmentOperations.create(file)))
        .catch(() => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("attachment.error"),
          });
        })
        .finally(() => {
          handleFetchPropertyActivities();
          setLastWidgetAction("attachments");
          setIsLoading(false);
        });
    },
    [attachmentOperations, attachmentSettings, workspaceSlug, handleFetchPropertyActivities, setLastWidgetAction, t]
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    multiple: true,
    disabled: isLoading || disabled,
  });

  return (
    <div
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {customButton ? (
        <div {...getRootProps({ role: "presentation", tabIndex: -1 })}>
          <input {...getInputProps()} />
          {customButton}
        </div>
      ) : (
        <button {...getRootProps()} type="button" disabled={disabled}>
          <input {...getInputProps()} />
          <PlusIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
