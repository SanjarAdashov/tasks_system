/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { Download, Eye, FileAudio, FileText, Play, Plus, Trash2, UploadCloud } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueAttachment, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { CircularProgressIndicator } from "@plane/ui";
import { convertBytesToSize, getFileExtension, getFileName } from "@plane/utils";
import { getFileIcon } from "@/components/icons";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// types
import type { TAttachmentHelpers } from "../issue-detail-widgets/attachments/helper";
import { AttachmentPreviewModal } from "./attachment-preview-modal";
import {
  getAttachmentPreviewKind,
  getAttachmentURLs,
  useProjectAttachmentSettings,
  validateProjectAttachment,
} from "./attachment-utils";
import { IssueAttachmentDeleteModal } from "./delete-attachment-modal";

type TIssueAttachmentItemList = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  attachmentHelpers: TAttachmentHelpers;
  disabled?: boolean;
  issueServiceType?: TIssueServiceType;
};

export const IssueAttachmentItemList = observer(function IssueAttachmentItemList(props: TIssueAttachmentItemList) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    attachmentHelpers,
    disabled,
    issueServiceType = EIssueServiceType.ISSUES,
  } = props;
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);

  const {
    attachment: { getAttachmentsByIssueId },
    issue: { getIssueById },
    attachmentDeleteModalId,
    toggleDeleteAttachmentModal,
    fetchActivities,
  } = useIssueDetail(issueServiceType);
  const { operations: attachmentOperations, snapshot: attachmentSnapshot } = attachmentHelpers;
  const { create: createAttachment } = attachmentOperations;
  const { uploadStatus } = attachmentSnapshot;
  const { data: attachmentSettings } = useProjectAttachmentSettings(workspaceSlug, projectId);
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();

  const issueAttachmentIds = getAttachmentsByIssueId(issueId) ?? [];
  const attachmentStore = useIssueDetail(issueServiceType).attachment;
  const issueAttachments = issueAttachmentIds
    .map((attachmentId) => attachmentStore.getAttachmentById(attachmentId))
    .filter((attachment): attachment is TIssueAttachment => Boolean(attachment));
  const previewableAttachments = issueAttachments.filter(
    (attachment) => getAttachmentPreviewKind(attachment) !== "download"
  );
  const previewAttachment = previewAttachmentId
    ? issueAttachments.find((attachment) => attachment.id === previewAttachmentId)
    : undefined;
  const issue = getIssueById(issueId);
  const canPerformProjectAdminActions = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const canDeleteAttachment = (attachment: TIssueAttachment) =>
    !disabled &&
    Boolean(
      currentUser?.id &&
      (attachment.created_by === currentUser.id ||
        issue?.created_by === currentUser.id ||
        canPerformProjectAdminActions)
    );

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

      setIsUploading(true);
      Promise.all(validFiles.map((file) => createAttachment(file)))
        .catch(() => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("attachment.error"),
          });
        })
        .finally(() => {
          handleFetchPropertyActivities();
          setIsUploading(false);
        });
    },
    [attachmentSettings, createAttachment, handleFetchPropertyActivities, t, workspaceSlug]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    disabled: isUploading || disabled,
    noClick: true,
  });

  return (
    <>
      {attachmentDeleteModalId && (
        <IssueAttachmentDeleteModal
          isOpen={Boolean(attachmentDeleteModalId)}
          onClose={() => toggleDeleteAttachmentModal(null)}
          attachmentOperations={attachmentOperations}
          attachmentId={attachmentDeleteModalId}
          issueServiceType={issueServiceType}
        />
      )}
      <AttachmentPreviewModal
        attachment={previewAttachment}
        previewableAttachments={previewableAttachments}
        onClose={() => setPreviewAttachmentId(null)}
        onSelect={setPreviewAttachmentId}
      />

      <div {...getRootProps()} className="relative min-w-0">
        <input {...getInputProps()} />
        {isDragActive && (
          <div className="absolute inset-0 z-30 flex min-h-36 items-center justify-center rounded-lg bg-surface-2/90">
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-strong bg-surface-1 px-6 py-5">
              <UploadCloud className="size-7" />
              <span className="mt-1 text-13 text-tertiary">{t("attachment.drag_and_drop")}</span>
            </div>
          </div>
        )}

        <div className="horizontal-scrollbar flex min-w-0 gap-3 overflow-x-auto pb-2">
          {uploadStatus?.map((status) => (
            <div
              key={status.id}
              className="flex h-36 w-48 shrink-0 flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1"
            >
              <div className="flex flex-1 items-center justify-center bg-surface-2">
                <CircularProgressIndicator size={42} strokeWidth={4} percentage={status.progress} />
              </div>
              <div className="border-t border-subtle px-2.5 py-2">
                <div className="truncate text-12 font-medium text-primary">{status.name}</div>
                <div className="mt-0.5 text-11 text-tertiary">
                  {t("attachment.uploading", { progress: status.progress })}
                </div>
              </div>
            </div>
          ))}

          {issueAttachments.map((attachment) => {
            const previewKind = getAttachmentPreviewKind(attachment);
            const { downloadUrl, inlineUrl } = getAttachmentURLs(attachment.asset_url);
            const extension = getFileExtension(attachment.attributes.name);
            const fileName = getFileName(attachment.attributes.name);
            const canDelete = canDeleteAttachment(attachment);

            return (
              <article
                key={attachment.id}
                className="group relative flex h-36 w-48 shrink-0 flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 transition-colors hover:border-strong"
              >
                <button
                  type="button"
                  className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (previewKind === "download") window.open(downloadUrl, "_blank", "noopener,noreferrer");
                    else setPreviewAttachmentId(attachment.id);
                  }}
                  aria-label={
                    previewKind === "download"
                      ? t("attachment.download_file", { name: attachment.attributes.name })
                      : t("attachment.preview_file", { name: attachment.attributes.name })
                  }
                >
                  {previewKind === "image" && (
                    <img
                      src={inlineUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  )}
                  {previewKind === "video" && (
                    <>
                      <video src={inlineUrl} muted preload="metadata" className="h-full w-full object-cover" />
                      <span className="absolute flex size-9 items-center justify-center rounded-full bg-black/60 text-white">
                        <Play className="ml-0.5 size-4 fill-current" />
                      </span>
                    </>
                  )}
                  {previewKind === "audio" && (
                    <div className="flex flex-col items-center gap-2 text-accent-primary">
                      <FileAudio className="size-10" />
                      <span className="text-11 text-secondary">{t("attachment.audio")}</span>
                    </div>
                  )}
                  {previewKind === "pdf" && (
                    <div className="text-red-500 flex flex-col items-center gap-2">
                      <FileText className="size-10" />
                      <span className="text-11 font-medium">PDF</span>
                    </div>
                  )}
                  {previewKind === "download" && (
                    <div className="flex flex-col items-center gap-2">
                      {getFileIcon(extension, 38)}
                      <span className="max-w-32 truncate text-11 text-secondary">
                        {extension ? extension.toUpperCase() : t("attachment.unknown_type")}
                      </span>
                    </div>
                  )}
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/30 text-white group-hover:flex">
                    {previewKind === "download" ? <Download className="size-5" /> : <Eye className="size-5" />}
                  </span>
                </button>

                <div className="border-t border-subtle px-2.5 py-2">
                  <div className="truncate pr-10 text-12 font-medium text-primary" title={attachment.attributes.name}>
                    {fileName}
                  </div>
                  <div className="mt-0.5 text-11 text-tertiary">{convertBytesToSize(attachment.attributes.size)}</div>
                </div>

                <div className="shadow-sm absolute right-1.5 bottom-1.5 flex items-center rounded bg-surface-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <a
                    href={downloadUrl}
                    className="rounded p-1.5 text-secondary hover:bg-surface-2 hover:text-primary"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={t("attachment.download")}
                    title={t("attachment.download")}
                  >
                    <Download className="size-3.5" />
                  </a>
                  {canDelete && (
                    <button
                      type="button"
                      className="hover:text-red-500 rounded p-1.5 text-secondary hover:bg-surface-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDeleteAttachmentModal(attachment.id);
                      }}
                      aria-label={t("attachment.delete")}
                      title={t("attachment.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {!disabled && (
            <button
              type="button"
              className="flex h-36 w-24 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-strong bg-surface-1 text-secondary hover:bg-surface-2 hover:text-primary"
              disabled={isUploading}
              onClick={open}
            >
              <Plus className="size-5" />
              <span className="px-2 text-center text-11">{t("attachment.add")}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
});
