/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TTranslationStore } from "@plane/i18n";

type TranslationFunction = TTranslationStore["t"];

type ErrorEntry = {
  field?: string;
  message: string;
};

const SERVER_MESSAGE_KEYS: Record<string, string> = {
  "This field is required.": "calendar.errors.required",
  "This field may not be blank.": "calendar.errors.required",
  "End time must be after start time.": "calendar.errors.end_after_start",
  "An all-day meeting must end on a later date.": "calendar.errors.all_day_end",
  "Project does not belong to this workspace.": "calendar.errors.project_workspace",
  "You are not an active project member.": "calendar.errors.project_member",
  "Task does not belong to the selected project.": "calendar.errors.task_project",
  "Task is unavailable.": "calendar.errors.task_unavailable",
  "Meeting type does not belong to this project.": "calendar.errors.type_project",
  "One or more users are inactive or blocked.": "calendar.errors.participant_inactive",
  "Internal participants must be active project members.": "calendar.errors.participant_project",
  "Internal participants must be active workspace members.": "calendar.errors.participant_workspace",
  "Unknown timezone.": "calendar.errors.timezone",
  "Use a valid RFC 5545 recurrence rule.": "calendar.errors.recurrence",
  "Calendar range must be positive and at most two years.": "calendar.errors.range",
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  title: "calendar.title_field",
  project_id: "calendar.project_field",
  issue_id: "calendar.task",
  meeting_type_id: "calendar.type",
  starts_at: "calendar.starts",
  ends_at: "calendar.ends",
  timezone: "calendar.timezone",
  participants: "calendar.participants",
  recurrence_rule: "calendar.repeat",
  reminder_minutes: "calendar.reminders",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unwrapError = (error: unknown): unknown => {
  if (!isRecord(error)) return error;
  const response = error.response;
  if (isRecord(response) && "data" in response) return response.data;
  return error;
};

const collectErrorEntries = (value: unknown, field?: string): ErrorEntry[] => {
  if (typeof value === "string") return [{ field, message: value }];
  if (typeof value === "number" || typeof value === "boolean") return [{ field, message: String(value) }];
  if (Array.isArray(value)) return value.flatMap((item) => collectErrorEntries(item, field));
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, item]) =>
    collectErrorEntries(item, key === "detail" || key === "non_field_errors" ? field : key)
  );
};

export const getCalendarErrorMessage = (error: unknown, t: TranslationFunction, fallback: string) => {
  const entries = collectErrorEntries(unwrapError(error));
  if (entries.length === 0) return fallback;

  const messages = entries.map(({ field, message }) => {
    const messageKey = SERVER_MESSAGE_KEYS[message];
    const localizedMessage = messageKey ? t(messageKey) : message;
    const fieldKey = field ? FIELD_LABEL_KEYS[field] : undefined;
    return fieldKey ? `${t(fieldKey)}: ${localizedMessage}` : localizedMessage;
  });

  return [...new Set(messages)].slice(0, 3).join("\n");
};
