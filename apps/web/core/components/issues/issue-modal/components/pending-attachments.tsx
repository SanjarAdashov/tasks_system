/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { Paperclip, Plus, Trash2, UploadCloud } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CircularProgressIndicator } from "@plane/ui";
import { convertBytesToSize, getFileExtension } from "@plane/utils";
import { getFileIcon } from "@/components/icons";
import {
  useProjectAttachmentSettings,
  validateProjectAttachment,
} from "@/components/issues/attachment/attachment-utils";

export type TPendingIssueAttachment = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "failed";
};

type Props = {
  attachments: TPendingIssueAttachment[];
  disabled?: boolean;
  onFilesAdd: (files: File[]) => void;
  onFileRemove: (attachmentId: string) => void;
  projectId: string;
  workspaceSlug: string;
};

export function PendingIssueAttachments(props: Props) {
  const { attachments, disabled = false, onFilesAdd, onFileRemove, projectId, workspaceSlug } = props;
  const { t } = useTranslation();
  const { data: attachmentSettings } = useProjectAttachmentSettings(workspaceSlug, projectId);

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

      if (validFiles.length > 0) onFilesAdd(validFiles);
    },
    [attachmentSettings, onFilesAdd, t]
  );

  const { getInputProps, getRootProps, isDragActive, open } = useDropzone({
    disabled,
    multiple: true,
    noClick: true,
    onDrop,
  });

  return (
    <div
      {...getRootProps()}
      className="relative overflow-hidden rounded-lg border border-dashed border-subtle bg-surface-2/40 p-3"
    >
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-2/95">
          <div className="flex items-center gap-2 text-13 font-medium text-primary">
            <UploadCloud className="size-5 text-accent-primary" />
            {t("attachment.drag_and_drop")}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Paperclip className="size-4 shrink-0 text-secondary" />
          <div className="min-w-0">
            <div className="text-13 font-medium text-primary">{t("attachments")}</div>
            <div className="truncate text-11 text-tertiary">{t("attachment.drag_and_drop")}</div>
          </div>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-2.5 py-1.5 text-12 font-medium text-secondary hover:bg-surface-2 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          <Plus className="size-3.5" />
          {t("attachment.add")}
        </button>
      </div>

      {attachments.length > 0 && (
        <div className="horizontal-scrollbar mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
          {attachments.map((attachment) => {
            const extension = getFileExtension(attachment.file.name);
            const isUploading = attachment.status === "uploading";

            return (
              <div
                key={attachment.id}
                className="flex w-56 shrink-0 items-center gap-2 rounded-md border border-subtle bg-surface-1 p-2"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-2">
                  {isUploading ? (
                    <CircularProgressIndicator size={24} strokeWidth={3} percentage={attachment.progress} />
                  ) : (
                    getFileIcon(extension, 22)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-12 font-medium text-primary" title={attachment.file.name}>
                    {attachment.file.name}
                  </div>
                  <div className="mt-0.5 text-11 text-tertiary">
                    {isUploading
                      ? t("attachment.uploading", { progress: attachment.progress })
                      : convertBytesToSize(attachment.file.size)}
                  </div>
                </div>
                {!isUploading && (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-tertiary hover:bg-surface-2 hover:text-primary"
                    disabled={disabled}
                    aria-label={t("attachment.delete")}
                    title={t("attachment.delete")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onFileRemove(attachment.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
