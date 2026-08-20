/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TCalendarConnection,
  TCalendarPreference,
  TCalendarAvailabilityResponse,
  TCalendarRangeResponse,
  TCalendarWorkspaceSettings,
  TMeeting,
  TMeetingAttachment,
  TMeetingPayload,
  TMeetingParticipant,
  TMeetingResponseStatus,
  TMeetingType,
  TWorkspaceHoliday,
} from "@plane/types";
import { APIService } from "@/services/api.service";

export class CalendarService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getRange(workspaceSlug: string, start: string, end: string, showCancelled = false) {
    return this.get(`/api/workspaces/${workspaceSlug}/calendar/meetings/`, {
      params: { start, end, show_cancelled: showCancelled || undefined },
    })
      .then((response) => response.data as TCalendarRangeResponse)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueMeetings(workspaceSlug: string, issueId: string): Promise<TMeeting[]> {
    const now = new Date();
    const dayInMilliseconds = 24 * 60 * 60 * 1000;
    // The calendar API accepts a maximum range of two years. Keep an even
    // one-year window around today so task history and upcoming meetings are
    // available without making the request invalid as the current year changes.
    const start = new Date(now.getTime() - 365 * dayInMilliseconds).toISOString();
    const end = new Date(now.getTime() + 365 * dayInMilliseconds).toISOString();
    return this.get(`/api/workspaces/${workspaceSlug}/calendar/meetings/`, {
      params: { start, end, issue_id: issueId, show_cancelled: true },
    })
      .then((response) => response.data.meetings)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getMeeting(workspaceSlug: string, meetingId: string): Promise<TMeeting> {
    return this.get(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/`)
      .then((response) => response.data as TMeeting)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueMeetingDefaults(workspaceSlug: string, projectId: string, issueId: string) {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/meeting-defaults/`)
      .then(
        (response) =>
          response.data as {
            title: string;
            project_id: string;
            issue_id: string;
            meeting_type_id: string | null;
            participants: TMeetingParticipant[];
          }
      )
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createMeeting(workspaceSlug: string, payload: TMeetingPayload): Promise<TMeeting> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/`, payload)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateMeeting(workspaceSlug: string, meetingId: string, payload: Partial<TMeetingPayload>): Promise<TMeeting> {
    return this.patch(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/`, payload)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteMeeting(workspaceSlug: string, meetingId: string) {
    return this.delete(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/`);
  }

  async cancelMeeting(workspaceSlug: string, meetingId: string, reason = ""): Promise<TMeeting> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/cancel/`, { reason }).then(
      (response) => response.data
    );
  }

  async respond(workspaceSlug: string, meetingId: string, responseStatus: TMeetingResponseStatus) {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/response/`, {
      response_status: responseStatus,
    }).then((response) => response.data);
  }

  async transferMeeting(workspaceSlug: string, meetingId: string, organizerId: string): Promise<TMeeting> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/transfer/`, {
      organizer_id: organizerId,
    }).then((response) => response.data);
  }

  async updateOccurrence(
    workspaceSlug: string,
    meetingId: string,
    originalStartsAt: string,
    action: "UPDATED" | "CANCELLED",
    overrides: Record<string, unknown> = {}
  ) {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/occurrence/`, {
      original_starts_at: originalStartsAt,
      action,
      overrides,
    }).then((response) => response.data);
  }

  async getAvailability(
    workspaceSlug: string,
    payload: {
      user_ids: string[];
      required_user_ids: string[];
      optional_user_ids: string[];
      start: string;
      end: string;
      duration_minutes: number;
      meeting_id?: string;
      find_slots?: boolean;
    }
  ): Promise<TCalendarAvailabilityResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/availability/`, payload).then(
      (response) => response.data
    );
  }

  async addComment(workspaceSlug: string, meetingId: string, body: string) {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/comments/`, { body }).then(
      (response) => response.data
    );
  }

  async uploadAttachment(workspaceSlug: string, meetingId: string, file: File): Promise<TMeetingAttachment> {
    const form = new FormData();
    form.append("asset", file);
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/attachments/`, form, {
      // Let the browser add the multipart boundary. Setting Content-Type by
      // hand produces an invalid body in Chromium and Django cannot read the
      // uploaded file from request.FILES.
      timeout: 0,
    })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteAttachment(workspaceSlug: string, meetingId: string, attachmentId: string) {
    return this.delete(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/attachments/${attachmentId}/`);
  }

  async updateAttachment(
    workspaceSlug: string,
    meetingId: string,
    attachmentId: string,
    sharedWithGuests: boolean
  ): Promise<TMeetingAttachment> {
    return this.patch(`/api/workspaces/${workspaceSlug}/calendar/meetings/${meetingId}/attachments/${attachmentId}/`, {
      shared_with_guests: sharedWithGuests,
    }).then((response) => response.data);
  }

  async resyncConnection(connectionId: string): Promise<{ queued: boolean; queued_at: string }> {
    return this.post(`/api/users/me/calendar/connections/${connectionId}/resync/`).then((response) => response.data);
  }

  async getConnectionCalendars(connectionId: string) {
    return this.get(`/api/users/me/calendar/connections/${connectionId}/calendars/`).then(
      (response) => response.data as Array<{ id: string; name: string; primary: boolean; selected: boolean }>
    );
  }

  async getMeetingTypes(workspaceSlug: string, projectId: string): Promise<TMeetingType[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/meeting-types/`).then(
      (response) => response.data
    );
  }

  async createMeetingType(workspaceSlug: string, projectId: string, payload: Partial<TMeetingType>) {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/meeting-types/`, payload).then(
      (response) => response.data as TMeetingType
    );
  }

  async updateMeetingType(
    workspaceSlug: string,
    projectId: string,
    meetingTypeId: string,
    payload: Partial<TMeetingType>
  ) {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/meeting-types/${meetingTypeId}/`,
      payload
    ).then((response) => response.data as TMeetingType);
  }

  async deleteMeetingType(workspaceSlug: string, projectId: string, meetingTypeId: string) {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/meeting-types/${meetingTypeId}/`);
  }

  async reorderMeetingTypes(workspaceSlug: string, projectId: string, ids: string[]): Promise<TMeetingType[]> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/meeting-types/reorder/`, { ids }).then(
      (response) => response.data
    );
  }

  async getSettings(workspaceSlug: string): Promise<TCalendarWorkspaceSettings> {
    return this.get(`/api/workspaces/${workspaceSlug}/calendar/settings/`).then((response) => response.data);
  }

  async updateSettings(workspaceSlug: string, payload: Partial<TCalendarWorkspaceSettings>) {
    return this.patch(`/api/workspaces/${workspaceSlug}/calendar/settings/`, payload).then(
      (response) => response.data as TCalendarWorkspaceSettings
    );
  }

  async listHolidays(workspaceSlug: string, start?: string, end?: string): Promise<TWorkspaceHoliday[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/calendar/holidays/`, { params: { start, end } }).then(
      (response) => response.data
    );
  }

  async syncHolidays(workspaceSlug: string) {
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/holidays/sync/`).then((response) => response.data);
  }

  async saveHoliday(workspaceSlug: string, payload: Partial<TWorkspaceHoliday>) {
    if (payload.id)
      return this.patch(`/api/workspaces/${workspaceSlug}/calendar/holidays/${payload.id}/`, payload).then(
        (response) => response.data as TWorkspaceHoliday
      );
    return this.post(`/api/workspaces/${workspaceSlug}/calendar/holidays/`, payload).then(
      (response) => response.data as TWorkspaceHoliday
    );
  }

  async deleteHoliday(workspaceSlug: string, holidayId: string) {
    return this.delete(`/api/workspaces/${workspaceSlug}/calendar/holidays/${holidayId}/`);
  }

  async getConnections(): Promise<TCalendarConnection[]> {
    return this.get("/api/users/me/calendar/connections/").then((response) => response.data);
  }

  async getPreferences(): Promise<TCalendarPreference> {
    return this.get("/api/users/me/calendar/preferences/").then((response) => response.data);
  }

  async updatePreferences(payload: Partial<TCalendarPreference>): Promise<TCalendarPreference> {
    return this.patch("/api/users/me/calendar/preferences/", payload).then((response) => response.data);
  }

  async createConnection(payload: Record<string, unknown>): Promise<TCalendarConnection> {
    return this.post("/api/users/me/calendar/connections/", payload).then((response) => response.data);
  }

  async deleteConnection(connectionId: string) {
    return this.delete(`/api/users/me/calendar/connections/${connectionId}/`);
  }

  async updateConnection(connectionId: string, payload: Partial<TCalendarConnection>) {
    return this.patch(`/api/users/me/calendar/connections/${connectionId}/`, payload).then(
      (response) => response.data as TCalendarConnection
    );
  }

  async getOAuthAuthorizationUrl(provider: "GOOGLE" | "MICROSOFT", returnUrl: string) {
    return this.get("/api/users/me/calendar/connections/oauth/start/", {
      params: { provider, return_url: returnUrl },
    }).then((response) => response.data as { authorization_url: string });
  }
}

const calendarService = new CalendarService();
export default calendarService;
