/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import type { TIssueAttachment, TProjectAttachmentSettings } from "@plane/types";
import { getFileExtension, getFileURL } from "@plane/utils";
import { ProjectService } from "@/services/project";

export type TAttachmentCategory = "image" | "video" | "audio" | "pdf" | "document" | "archive" | "other";
export type TAttachmentPreviewKind = "image" | "video" | "audio" | "pdf" | "download";

const ARCHIVE_MIME_TYPES = new Set([
  "application/gzip",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-compressed",
  "application/x-compressed-tar",
  "application/x-compressed-tar-7z",
  "application/x-compressed-tar-bz2",
  "application/x-compressed-tar-gz",
  "application/x-compressed-tar-zip",
  "application/x-rar",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/x-zip",
  "application/x-zip-compressed",
  "application/zip",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/json",
  "application/msword",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.database",
  "application/vnd.oasis.opendocument.graphics",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.visio",
  "application/xml",
  "text/csv",
  "text/css",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "zip"]);
const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "json",
  "md",
  "odp",
  "ods",
  "odt",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "vsd",
  "xls",
  "xlsx",
  "xml",
]);
const SAFE_IMAGE_EXTENSIONS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav", "webm"]);

const SETTING_BY_CATEGORY: Record<
  TAttachmentCategory,
  keyof Pick<
    TProjectAttachmentSettings,
    | "image_max_size"
    | "video_max_size"
    | "audio_max_size"
    | "pdf_max_size"
    | "document_max_size"
    | "archive_max_size"
    | "other_max_size"
  >
> = {
  image: "image_max_size",
  video: "video_max_size",
  audio: "audio_max_size",
  pdf: "pdf_max_size",
  document: "document_max_size",
  archive: "archive_max_size",
  other: "other_max_size",
};

const projectService = new ProjectService();

const normalizeMimeType = (mimeType?: string) =>
  (mimeType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();

export const getAttachmentCategory = (mimeType?: string, filename = ""): TAttachmentCategory => {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const extension = getFileExtension(filename).toLowerCase();

  if (normalizedMimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("video/")) return "video";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (ARCHIVE_MIME_TYPES.has(normalizedMimeType) || ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (DOCUMENT_MIME_TYPES.has(normalizedMimeType) || DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "other";
};

export const getAttachmentPreviewKind = (attachment: TIssueAttachment): TAttachmentPreviewKind => {
  const mimeType = normalizeMimeType(attachment.attributes.type);
  const extension = getFileExtension(attachment.attributes.name).toLowerCase();

  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (
    ["image/bmp", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(mimeType) ||
    SAFE_IMAGE_EXTENSIONS.has(extension)
  )
    return "image";
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "download";
};

export const getAttachmentURLs = (assetUrl: string) => {
  const downloadUrl = getFileURL(assetUrl) ?? "";
  const separator = downloadUrl.includes("?") ? "&" : "?";
  return {
    downloadUrl,
    inlineUrl: `${downloadUrl}${separator}disposition=inline`,
  };
};

export type TAttachmentValidationResult =
  | { valid: true; category: TAttachmentCategory }
  | { valid: false; category: TAttachmentCategory; reason: "disabled" }
  | { valid: false; category: TAttachmentCategory; reason: "too_large"; maxSize: number };

export const validateProjectAttachment = (
  file: File,
  settings?: TProjectAttachmentSettings
): TAttachmentValidationResult => {
  const category = getAttachmentCategory(file.type, file.name);
  if (!settings) return { valid: true, category };

  const maxSize = settings[SETTING_BY_CATEGORY[category]];
  if (maxSize === 0) return { valid: false, category, reason: "disabled" };
  if (maxSize !== null && file.size > maxSize) return { valid: false, category, reason: "too_large", maxSize };
  return { valid: true, category };
};

export const useProjectAttachmentSettings = (workspaceSlug: string, projectId: string) =>
  useSWR<TProjectAttachmentSettings>(
    workspaceSlug && projectId ? `PROJECT_ATTACHMENT_SETTINGS_${workspaceSlug}_${projectId}` : null,
    () => projectService.getAttachmentSettings(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );
