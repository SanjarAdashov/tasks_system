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
      const totalAttachedFiles = acceptedFiles.length + rejectedFiles.length;

      if (rejectedFiles.length === 0) {
        const currentFile: File = acceptedFiles[0];
        if (!currentFile || !workspaceSlug) return;

        const validation = validateProjectAttachment(currentFile, attachmentSettings);
        if (!validation.valid) {
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
          return;
        }

        setIsLoading(true);
        attachmentOperations
          .create(currentFile)
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
        return;
      }

      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: totalAttachedFiles > 1 ? t("attachment.only_one_file_allowed") : t("attachment.error"),
      });
    },
    [attachmentOperations, attachmentSettings, workspaceSlug, handleFetchPropertyActivities, setLastWidgetAction, t]
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    multiple: false,
    disabled: isLoading || disabled,
  });

  return (
    <div>
      <button {...getRootProps({ onClick: (event) => event.stopPropagation() })} type="button" disabled={disabled}>
        <input {...getInputProps()} />
        {customButton ? customButton : <PlusIcon className="h-4 w-4" />}
      </button>
    </div>
  );
});
