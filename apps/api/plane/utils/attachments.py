# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from pathlib import Path

from rest_framework import serializers

from plane.db.models.attachment import (
    AttachmentFileCategory,
    ProjectAttachmentSettings,
)


ARCHIVE_MIME_TYPES = {
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
}

DOCUMENT_MIME_TYPES = {
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
}

ARCHIVE_EXTENSIONS = {
    ".7z",
    ".bz2",
    ".gz",
    ".rar",
    ".tar",
    ".tgz",
    ".zip",
}

DOCUMENT_EXTENSIONS = {
    ".csv",
    ".doc",
    ".docx",
    ".json",
    ".md",
    ".odp",
    ".ods",
    ".odt",
    ".ppt",
    ".pptx",
    ".rtf",
    ".txt",
    ".vsd",
    ".xls",
    ".xlsx",
    ".xml",
}

SIZE_FIELD_BY_CATEGORY = {
    AttachmentFileCategory.IMAGE: "image_max_size",
    AttachmentFileCategory.VIDEO: "video_max_size",
    AttachmentFileCategory.AUDIO: "audio_max_size",
    AttachmentFileCategory.PDF: "pdf_max_size",
    AttachmentFileCategory.DOCUMENT: "document_max_size",
    AttachmentFileCategory.ARCHIVE: "archive_max_size",
    AttachmentFileCategory.OTHER: "other_max_size",
}

INLINE_PREVIEW_MIME_TYPES = {
    "application/pdf",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}


def normalize_mime_type(mime_type):
    return (mime_type or "application/octet-stream").split(";", 1)[0].strip().lower()


def get_attachment_file_category(mime_type, filename=""):
    normalized_mime_type = normalize_mime_type(mime_type)
    extension = Path(filename or "").suffix.lower()

    if normalized_mime_type == "application/pdf" or extension == ".pdf":
        return AttachmentFileCategory.PDF
    if normalized_mime_type.startswith("image/"):
        return AttachmentFileCategory.IMAGE
    if normalized_mime_type.startswith("video/"):
        return AttachmentFileCategory.VIDEO
    if normalized_mime_type.startswith("audio/"):
        return AttachmentFileCategory.AUDIO
    if normalized_mime_type in ARCHIVE_MIME_TYPES or extension in ARCHIVE_EXTENSIONS:
        return AttachmentFileCategory.ARCHIVE
    if normalized_mime_type in DOCUMENT_MIME_TYPES or extension in DOCUMENT_EXTENSIONS:
        return AttachmentFileCategory.DOCUMENT
    return AttachmentFileCategory.OTHER


def get_project_attachment_settings(project):
    settings, _ = ProjectAttachmentSettings.objects.get_or_create(project=project)
    return settings


def validate_attachment_size(size):
    try:
        normalized_size = int(size)
    except (TypeError, ValueError):
        raise serializers.ValidationError({"size": "File size must be a positive integer."})

    if normalized_size <= 0:
        raise serializers.ValidationError({"size": "File size must be greater than zero."})
    return normalized_size


def validate_project_attachment_size(*, project, mime_type, filename, size):
    normalized_size = validate_attachment_size(size)

    category = get_attachment_file_category(mime_type, filename)
    project_settings = get_project_attachment_settings(project)
    max_size = getattr(project_settings, SIZE_FIELD_BY_CATEGORY[category])

    if max_size == 0:
        raise serializers.ValidationError(
            {
                "size": "Uploads for this file category are disabled in the project.",
                "category": category,
                "max_size": 0,
            }
        )
    if max_size is not None and normalized_size > max_size:
        raise serializers.ValidationError(
            {
                "size": "File exceeds the maximum size configured for this project.",
                "category": category,
                "max_size": max_size,
            }
        )

    return normalized_size


def get_attachment_disposition(mime_type, requested_disposition):
    if requested_disposition != "inline":
        return "attachment"

    normalized_mime_type = normalize_mime_type(mime_type)
    if (
        normalized_mime_type in INLINE_PREVIEW_MIME_TYPES
        or normalized_mime_type.startswith("video/")
        or normalized_mime_type.startswith("audio/")
    ):
        return "inline"

    # SVG, HTML, JavaScript, XML, and every unknown format are never returned
    # as inline active content. The web client may fetch SVG as a Blob and use
    # it only in an image context.
    return "attachment"
