/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileAudio, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TIssueAttachment } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { convertBytesToSize, getFileExtension } from "@plane/utils";
import { getFileIcon } from "@/components/icons";
import { getAttachmentPreviewKind, getAttachmentURLs } from "./attachment-utils";

type Props = {
  attachment: TIssueAttachment | undefined;
  previewableAttachments: TIssueAttachment[];
  onClose: () => void;
  onSelect: (attachmentId: string) => void;
};

export function AttachmentPreviewModal({ attachment, previewableAttachments, onClose, onSelect }: Props) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [attachment?.id]);

  if (!attachment) return null;

  const previewKind = getAttachmentPreviewKind(attachment);
  const { downloadUrl, inlineUrl } = getAttachmentURLs(attachment.asset_url);
  const currentIndex = previewableAttachments.findIndex((item) => item.id === attachment.id);
  const previousAttachment =
    currentIndex > 0 ? previewableAttachments[currentIndex - 1] : previewableAttachments.at(-1);
  const nextAttachment =
    currentIndex < previewableAttachments.length - 1
      ? previewableAttachments[currentIndex + 1]
      : previewableAttachments[0];
  const hasNavigation = previewableAttachments.length > 1;
  const extension = getFileExtension(attachment.attributes.name).toUpperCase();

  return (
    <ModalCore
      isOpen
      handleClose={onClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.VIIXL}
      className="overflow-hidden"
    >
      <div className="flex h-[88vh] min-h-[32rem] flex-col bg-surface-1">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-subtle px-4">
          <div className="min-w-0">
            <div className="truncate text-13 font-medium text-primary">{attachment.attributes.name}</div>
            <div className="text-11 text-tertiary">
              {extension || t("attachment.unknown_type")} · {convertBytesToSize(attachment.attributes.size)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {previewKind === "image" && (
              <>
                <button
                  type="button"
                  className="rounded p-2 text-secondary hover:bg-surface-2 hover:text-primary"
                  onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
                  aria-label={t("attachment.preview.zoom_out")}
                  title={t("attachment.preview.zoom_out")}
                >
                  <ZoomOut className="size-4" />
                </button>
                <button
                  type="button"
                  className="min-w-12 rounded px-2 py-1 text-11 text-secondary hover:bg-surface-2"
                  onClick={() => setZoom(1)}
                  title={t("attachment.preview.reset_zoom")}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="rounded p-2 text-secondary hover:bg-surface-2 hover:text-primary"
                  onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                  aria-label={t("attachment.preview.zoom_in")}
                  title={t("attachment.preview.zoom_in")}
                >
                  <ZoomIn className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-2 text-secondary hover:bg-surface-2 hover:text-primary"
                  onClick={() => setRotation((value) => (value + 90) % 360)}
                  aria-label={t("attachment.preview.rotate")}
                  title={t("attachment.preview.rotate")}
                >
                  <RotateCw className="size-4" />
                </button>
              </>
            )}
            <a
              href={downloadUrl}
              className="rounded p-2 text-secondary hover:bg-surface-2 hover:text-primary"
              aria-label={t("attachment.download")}
              title={t("attachment.download")}
            >
              <Download className="size-4" />
            </a>
            <button
              type="button"
              className="rounded p-2 text-secondary hover:bg-surface-2 hover:text-primary"
              onClick={onClose}
              aria-label={t("close")}
              title={t("close")}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas">
          {previewKind === "image" && (
            <img
              src={inlineUrl}
              alt={attachment.attributes.name}
              className="max-h-full max-w-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            />
          )}
          {previewKind === "video" && (
            <video key={inlineUrl} src={inlineUrl} controls autoPlay className="max-h-full max-w-full bg-black">
              {t("attachment.preview.not_supported")}
              <track kind="captions" />
            </video>
          )}
          {previewKind === "audio" && (
            <div className="mx-6 flex w-full max-w-xl flex-col items-center gap-8 rounded-xl border border-subtle bg-surface-1 p-8 shadow-raised-100">
              <div className="flex size-24 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary">
                <FileAudio className="size-12" />
              </div>
              <div className="w-full min-w-0 text-center">
                <div className="text-15 truncate font-medium text-primary">{attachment.attributes.name}</div>
                <audio key={inlineUrl} src={inlineUrl} controls autoPlay className="mt-5 w-full">
                  {t("attachment.preview.not_supported")}
                  <track kind="captions" />
                </audio>
              </div>
            </div>
          )}
          {previewKind === "pdf" && (
            <iframe
              key={inlineUrl}
              src={inlineUrl}
              title={attachment.attributes.name}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-downloads allow-same-origin"
            />
          )}

          {hasNavigation && (
            <>
              <button
                type="button"
                className="absolute left-3 flex size-10 items-center justify-center rounded-full bg-surface-1/90 text-secondary shadow-raised-100 hover:text-primary"
                onClick={() => previousAttachment && onSelect(previousAttachment.id)}
                aria-label={t("attachment.preview.previous")}
                title={t("attachment.preview.previous")}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                className="absolute right-3 flex size-10 items-center justify-center rounded-full bg-surface-1/90 text-secondary shadow-raised-100 hover:text-primary"
                onClick={() => nextAttachment && onSelect(nextAttachment.id)}
                aria-label={t("attachment.preview.next")}
                title={t("attachment.preview.next")}
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>

        <div className="flex h-10 shrink-0 items-center justify-center border-t border-subtle px-4 text-11 text-tertiary">
          {currentIndex + 1} / {previewableAttachments.length} ·{" "}
          {getFileIcon(getFileExtension(attachment.attributes.name), 14)}
        </div>
      </div>
    </ModalCore>
  );
}
