/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export interface ICalendarRange {
  startDate: Date;
  endDate: Date;
}

export interface ICalendarDate {
  date: Date;
  year: number;
  month: number;
  day: number;
  week: number; // week number wrt year, eg- 51, 52
  is_current_month: boolean;
  is_current_week: boolean;
  is_today: boolean;
}

export interface ICalendarWeek {
  [date: string]: ICalendarDate;
}

export interface ICalendarMonth {
  [monthIndex: string]: {
    [weekNumber: string]: ICalendarWeek;
  };
}

export interface ICalendarPayload {
  [year: string]: ICalendarMonth;
}

export type TMeetingVisibility = "PROJECT" | "RESTRICTED" | "PERSONAL";
export type TMeetingStatus = "PLANNED" | "COMPLETED" | "CANCELLED";
export type TMeetingAttendanceMode = "ONLINE" | "OFFLINE" | "MIXED";
export type TMeetingResponseStatus = "NO_RESPONSE" | "ACCEPTED" | "TENTATIVE" | "DECLINED";
export type TMeetingParticipantRole = "REQUIRED" | "OPTIONAL";
export type TCalendarView = "DAY" | "WEEK" | "MONTH" | "SCHEDULE";

export interface TCalendarPreference {
  id: string;
  default_view: TCalendarView;
  filters: Record<string, unknown>;
  external_routing: Record<string, unknown>;
  default_reminders: number[];
  working_hours: Record<string, { enabled: boolean; start: string; end: string }>;
  show_weekends: boolean;
  email_notifications_enabled: boolean;
  in_app_notifications_enabled: boolean;
  updated_at: string;
}

export interface TCalendarUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url?: string | null;
  user_timezone: string;
}

export interface TMeetingParticipant {
  id?: string;
  user?: TCalendarUser | null;
  user_id?: string;
  email: string;
  name: string;
  role: TMeetingParticipantRole;
  response_status?: TMeetingResponseStatus;
  source?: string;
  source_identifier?: string | null;
  responded_at?: string | null;
  removed_at?: string | null;
}

export interface TMeetingType {
  id: string;
  name: string;
  color: string;
  icon: string;
  default_duration_minutes: number;
  default_reminders: number[];
  default_attendance_mode: TMeetingAttendanceMode;
  is_default: boolean;
  sort_order: number;
}

export interface TMeeting {
  id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  project_identifier?: string | null;
  project_name?: string | null;
  issue_id?: string | null;
  issue_sequence_id?: number | null;
  meeting_type_id?: string | null;
  organizer: TCalendarUser;
  title: string;
  description?: string;
  agenda?: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  location?: string;
  attendance_mode: TMeetingAttendanceMode;
  meeting_url?: string;
  meeting_url_source: "NONE" | "MANUAL" | "GOOGLE_MEET";
  google_meet_open_access: boolean;
  visibility: TMeetingVisibility;
  availability: "BUSY" | "FREE" | "MAYBE" | "AWAY";
  status: TMeetingStatus;
  recurrence_rule?: string;
  recurrence_timezone?: string;
  recurrence_until?: string | null;
  type_name_snapshot?: string;
  type_color_snapshot?: string;
  type_icon_snapshot?: string;
  task_snapshot?: Record<string, unknown>;
  participant_details?: TMeetingParticipant[];
  reminders?: Array<{ id: string; minutes_before: number; scheduled_for: string; channel: string }>;
  comments?: Array<{ id: string; user: TCalendarUser; body: string; created_at: string }>;
  attachments?: TMeetingAttachment[];
  detail_access: boolean;
  can_manage: boolean;
  can_respond: boolean;
  my_response_status?: TMeetingResponseStatus | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
}

export interface TMeetingAttachment {
  id: string;
  asset_id: string;
  name: string;
  size: number;
  shared_with_guests: boolean;
  url: string;
  can_delete: boolean;
  created_at: string;
}

export interface TCalendarAvailabilityResponse {
  busy: Record<string, Array<{ starts_at: string; ends_at: string; source: string }>>;
  suggested_slots: Array<{
    starts_at: string;
    ends_at: string;
    optional_conflicts: string[];
    outside_working_hours: string[];
    score: number;
  }>;
}

export interface TMeetingOccurrence {
  meeting_id: string;
  occurrence_id: string;
  original_starts_at: string;
  starts_at: string;
  ends_at: string;
}

export interface TWorkspaceHoliday {
  id: string;
  date: string;
  name: string;
  kind: "HOLIDAY" | "DAY_OFF" | "WORKDAY";
  source: "MY_GOV" | "MANUAL" | "CORPORATE";
  is_override: boolean;
}

export interface TCalendarExternalEvent {
  id: string;
  meeting_id?: string | null;
  provider: "GOOGLE" | "MICROSOFT" | "ICLOUD" | "CALDAV";
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  availability: "BUSY" | "FREE" | "MAYBE" | "AWAY";
}

export interface TCalendarBirthdayEvent {
  id: string;
  date: string;
  user: {
    id: string;
    first_name: string;
    last_name: string;
    avatar_url?: string | null;
  };
}

export interface TCalendarRangeResponse {
  meetings: TMeeting[];
  occurrences: TMeetingOccurrence[];
  external_events: TCalendarExternalEvent[];
  holidays: TWorkspaceHoliday[];
  birthday_events: TCalendarBirthdayEvent[];
}

export interface TMeetingPayload {
  project_id?: string | null;
  issue_id?: string | null;
  meeting_type_id?: string | null;
  title: string;
  description?: string;
  agenda?: string;
  starts_at: string;
  ends_at: string;
  all_day?: boolean;
  timezone: string;
  location?: string;
  attendance_mode: TMeetingAttendanceMode;
  meeting_url?: string;
  google_meet_open_access?: boolean;
  visibility?: TMeetingVisibility;
  availability?: "BUSY" | "FREE" | "MAYBE" | "AWAY";
  recurrence_rule?: string;
  recurrence_timezone?: string;
  recurrence_until?: string | null;
  participants?: TMeetingParticipant[];
  reminder_minutes?: number[];
}

export interface TCalendarWorkspaceSettings {
  id: string;
  country_code: string;
  working_hours: Record<string, { enabled: boolean; start: string; end: string }>;
  holiday_sync_enabled: boolean;
  holiday_source_url: string;
  holiday_last_synced_at?: string | null;
  holiday_last_error?: string;
}

export interface TCalendarConnection {
  id: string;
  provider: "GOOGLE" | "MICROSOFT" | "ICLOUD" | "CALDAV";
  account_email: string;
  account_label: string;
  status: "CONNECTED" | "PARTIAL" | "PAUSED" | "ERROR";
  selected_calendars: string[];
  sync_mode: "FULL" | "INBOUND_BUSY" | "OUTBOUND_GTS" | "DISABLED";
  last_synced_at?: string | null;
  last_error_at?: string | null;
  last_error?: string;
  has_credentials: boolean;
}
