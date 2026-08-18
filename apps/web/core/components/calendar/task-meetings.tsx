/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import { CalendarPlus, Clock3, RefreshCw, Users } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IWorkspaceMember, TMeetingParticipant, TPartialProject } from "@plane/types";
import calendarService from "@/services/calendar.service";
import { ProjectService } from "@/services/project/project.service";
import { WorkspaceService } from "@/services/workspace.service";
import { MeetingFormModal } from "./meeting-form-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

type TaskMeetingPrefill = {
  title: string;
  projectId: string;
  issueId: string;
  meetingTypeId?: string | null;
  participants: TMeetingParticipant[];
};

const projectService = new ProjectService();
const workspaceService = new WorkspaceService();

export function TaskMeetings({ workspaceSlug, projectId, issueId, disabled = false }: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<TaskMeetingPrefill | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const { data: meetings = [], mutate } = useSWR(
    workspaceSlug && issueId ? `TASK_MEETINGS_${workspaceSlug}_${issueId}` : null,
    () => calendarService.getIssueMeetings(workspaceSlug, issueId),
    { revalidateOnFocus: false }
  );
  const { data: projects = [] } = useSWR<TPartialProject[]>(
    workspaceSlug ? `GTS_CALENDAR_PROJECTS_${workspaceSlug}` : null,
    () => projectService.getProjectsLite(workspaceSlug),
    { revalidateOnFocus: false }
  );
  const { data: workspaceMembers = [] } = useSWR<IWorkspaceMember[]>(
    workspaceSlug ? `GTS_CALENDAR_MEMBERS_${workspaceSlug}` : null,
    () => workspaceService.fetchWorkspaceMembers(workspaceSlug),
    { revalidateOnFocus: false }
  );

  const prepare = async () => {
    setIsPreparing(true);
    try {
      const defaults = await calendarService.getIssueMeetingDefaults(workspaceSlug, projectId, issueId);
      setPrefill({
        title: defaults.title,
        projectId: defaults.project_id,
        issueId: defaults.issue_id,
        meetingTypeId: defaults.meeting_type_id,
        participants: defaults.participants,
      });
      setIsOpen(true);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("calendar.saving_error") });
    } finally {
      setIsPreparing(false);
    }
  };

  const initialDate = new Date(Date.now() + 60 * 60 * 1000);
  initialDate.setMinutes(0, 0, 0);

  return (
    <section className="rounded-xl border border-subtle bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-13 font-semibold text-primary">
            <CalendarPlus className="size-4 text-accent-primary" /> {t("calendar.task_meetings")}
          </div>
          <p className="mt-0.5 text-11 text-secondary">{t("calendar.task_meetings_hint")}</p>
        </div>
        {!disabled && (
          <Button
            variant="secondary"
            prependIcon={<CalendarPlus className="size-4" />}
            loading={isPreparing}
            onClick={prepare}
          >
            {t("calendar.schedule_from_task")}
          </Button>
        )}
      </div>
      {meetings.length > 0 ? (
        <div className="divide-y divide-subtle">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: meeting.type_color_snapshot || "#22A06B" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-12 font-medium text-primary">{meeting.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-10 text-secondary">
                  <span className="flex items-center gap-1">
                    <Clock3 className="size-3" /> {format(new Date(meeting.starts_at), "dd.MM.yyyy HH:mm")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3" /> {meeting.participant_details?.length || 0}
                  </span>
                </div>
              </div>
              <span className="rounded-full bg-layer-1 px-2 py-1 text-9 font-semibold text-secondary uppercase">
                {meeting.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-5 text-11 text-tertiary">
          <RefreshCw className="size-4" /> {t("calendar.no_task_meetings")}
        </div>
      )}

      <MeetingFormModal
        workspaceSlug={workspaceSlug}
        isOpen={isOpen}
        initialDate={initialDate}
        projects={projects}
        workspaceMembers={workspaceMembers}
        prefill={prefill}
        onClose={() => setIsOpen(false)}
        onSaved={() => void mutate()}
      />
    </section>
  );
}
