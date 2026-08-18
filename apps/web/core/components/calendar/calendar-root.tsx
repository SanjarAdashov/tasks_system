/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { orderBy } from "lodash-es";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  MapPin,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  UserRound,
  Users,
  Download,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IWorkspaceMember,
  TCalendarExternalEvent,
  TCalendarView,
  TMeeting,
  TMeetingAttachment,
  TMeetingOccurrence,
  TPartialProject,
  TWorkspaceHoliday,
} from "@plane/types";
import { cn } from "@plane/utils";
import calendarService from "@/services/calendar.service";
import { ProjectService } from "@/services/project/project.service";
import { WorkspaceService } from "@/services/workspace.service";
import { MeetingFormModal } from "./meeting-form-modal";
import { CalendarSelect } from "./calendar-select";

type Props = { workspaceSlug: string };

type DisplayMeeting = TMeeting & {
  occurrenceId: string;
  originalStartsAt: string;
  displayStartsAt: string;
  displayEndsAt: string;
};

const projectService = new ProjectService();
const workspaceService = new WorkspaceService();

const localeCode = (locale: string) => (locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-UZ" : "en-US");
const memberName = (member: IWorkspaceMember) => {
  const firstName = member.member?.first_name || member.first_name || "";
  const lastName = member.member?.last_name || member.last_name || "";
  return `${firstName} ${lastName}`.trim() || member.member?.email || member.email || "—";
};

const rangeForView = (view: TCalendarView, date: Date) => {
  if (view === "DAY") return { start: startOfDay(date), end: endOfDay(date) };
  if (view === "WEEK")
    return {
      start: startOfWeek(date, { weekStartsOn: 1 }),
      end: endOfWeek(date, { weekStartsOn: 1 }),
    };
  if (view === "SCHEDULE") return { start: startOfDay(date), end: endOfDay(addDays(date, 30)) };
  return {
    start: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(date), { weekStartsOn: 1 }),
  };
};

const holidayForDate = (holidays: TWorkspaceHoliday[], date: Date) => {
  const rows = holidays.filter((item) => item.date === format(date, "yyyy-MM-dd"));
  return rows.find((item) => item.is_override) || rows[0];
};

const getMeetingColor = (meeting: TMeeting) =>
  meeting.status === "CANCELLED" ? "#6B7280" : meeting.type_color_snapshot || "#22A06B";

const isPastCalendarDate = (date: Date) => startOfDay(date) < startOfDay(new Date());

function MeetingChip({ meeting, onClick }: { meeting: DisplayMeeting; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "group shadow-xs hover:shadow-sm flex w-full min-w-0 items-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-2 py-1 text-left transition hover:-translate-y-px hover:border-strong",
        meeting.status === "CANCELLED" && "line-through opacity-60"
      )}
    >
      <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: getMeetingColor(meeting) }} />
      <span className="font-mono flex-shrink-0 text-9 text-tertiary">
        {meeting.all_day ? "•" : format(new Date(meeting.displayStartsAt), "HH:mm")}
      </span>
      <span className="truncate text-11 font-medium text-primary">{meeting.title}</span>
    </button>
  );
}

function MeetingDetails({
  meeting,
  workspaceSlug,
  onClose,
  onEdit,
  onChanged,
}: {
  meeting: DisplayMeeting;
  workspaceSlug: string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t, currentLocale } = useTranslation();
  const dateLocale = localeCode(currentLocale);
  const [isWorking, setIsWorking] = useState(false);
  const [attachments, setAttachments] = useState(meeting.attachments || []);
  const [comments, setComments] = useState(meeting.comments || []);
  const [comment, setComment] = useState("");
  const [newOrganizerId, setNewOrganizerId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  useEffect(() => {
    setAttachments(meeting.attachments || []);
    setComments(meeting.comments || []);
    setComment("");
    setNewOrganizerId("");
  }, [meeting]);

  const uploadFiles = async (files: FileList | File[]) => {
    setIsUploading(true);
    try {
      const uploaded: TMeetingAttachment[] = await Promise.all(
        Array.from(files).map((file) => calendarService.uploadAttachment(workspaceSlug, meeting.id, file))
      );
      setAttachments((current) => [...current, ...uploaded]);
      onChanged();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: t("calendar.saving_error") });
    } finally {
      setIsUploading(false);
    }
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    setIsWorking(true);
    try {
      const created = await calendarService.addComment(workspaceSlug, meeting.id, comment.trim());
      setComments((current) => [...current, created]);
      setComment("");
      onChanged();
    } finally {
      setIsWorking(false);
    }
  };
  const respond = async (responseStatus: "ACCEPTED" | "TENTATIVE" | "DECLINED") => {
    setIsWorking(true);
    try {
      await calendarService.respond(workspaceSlug, meeting.id, responseStatus);
      onChanged();
    } finally {
      setIsWorking(false);
    }
  };
  const cancelMeeting = async () => {
    if (!window.confirm(t("calendar.cancel_meeting"))) return;
    setIsWorking(true);
    try {
      await calendarService.cancelMeeting(workspaceSlug, meeting.id);
      onChanged();
      onClose();
    } finally {
      setIsWorking(false);
    }
  };
  const deleteMeeting = async () => {
    if (!window.confirm(t("calendar.delete_meeting"))) return;
    setIsWorking(true);
    try {
      await calendarService.deleteMeeting(workspaceSlug, meeting.id);
      onChanged();
      onClose();
    } finally {
      setIsWorking(false);
    }
  };
  const transferMeeting = async () => {
    if (!newOrganizerId || !window.confirm(t("calendar.transfer_organizer_confirm"))) return;
    setIsWorking(true);
    try {
      await calendarService.transferMeeting(workspaceSlug, meeting.id, newOrganizerId);
      setNewOrganizerId("");
      onChanged();
    } finally {
      setIsWorking(false);
    }
  };
  const cancelOccurrence = async () => {
    if (!window.confirm(t("calendar.cancel_occurrence_confirm"))) return;
    setIsWorking(true);
    try {
      await calendarService.updateOccurrence(workspaceSlug, meeting.id, meeting.originalStartsAt, "CANCELLED");
      onChanged();
      onClose();
    } finally {
      setIsWorking(false);
    }
  };
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex justify-end bg-backdrop/60 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <aside
        className="shadow-2xl h-full w-full max-w-[520px] overflow-y-auto border-l border-subtle bg-surface-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-subtle bg-surface-1 px-5 py-4">
          <div className="text-11 font-semibold tracking-wide text-secondary uppercase">
            {t("calendar.meeting_details")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid size-8 place-items-center rounded-md text-secondary hover:bg-layer-1"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-6 p-6">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-1 text-10 font-semibold text-white"
                style={{ backgroundColor: getMeetingColor(meeting) }}
              >
                {meeting.type_name_snapshot || (meeting.project_id ? t("calendar.project") : t("calendar.personal"))}
              </span>
              {meeting.project_identifier && (
                <span className="rounded-full bg-layer-1 px-2 py-1 text-10 text-secondary">
                  {meeting.project_identifier}
                </span>
              )}
            </div>
            <h2 className="text-24 leading-8 font-semibold text-primary">{meeting.title}</h2>
            {meeting.description && (
              <p className="mt-3 text-13 whitespace-pre-wrap text-secondary">{meeting.description}</p>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-subtle bg-surface-2 p-4">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 size-4 text-accent-primary" />
              <div className="text-13 text-primary">
                {new Intl.DateTimeFormat(dateLocale, { dateStyle: "full", timeStyle: "short" }).format(
                  new Date(meeting.displayStartsAt)
                )}
                <div className="mt-0.5 text-11 text-secondary">
                  —{" "}
                  {new Intl.DateTimeFormat(dateLocale, { timeStyle: "short" }).format(new Date(meeting.displayEndsAt))}
                </div>
              </div>
            </div>
            {meeting.location && (
              <div className="flex items-center gap-3 text-13 text-primary">
                <MapPin className="size-4 text-tertiary" /> {meeting.location}
              </div>
            )}
            <div className="flex items-center gap-3 text-13 text-primary">
              <UserRound className="size-4 text-tertiary" />
              {meeting.organizer.first_name} {meeting.organizer.last_name}
            </div>
            {meeting.meeting_url && (
              <a
                href={meeting.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-md bg-accent-primary px-3 py-2 text-12 font-semibold text-on-color"
              >
                <ExternalLink className="size-4" /> {t("calendar.join")}
              </a>
            )}
          </div>

          {meeting.participant_details && (
            <div>
              <div className="mb-3 flex items-center gap-2 text-12 font-semibold text-primary">
                <Users className="size-4 text-tertiary" /> {t("calendar.participants")} ·{" "}
                {meeting.participant_details.length}
              </div>
              <div className="space-y-1.5">
                {meeting.participant_details.map((participant) => (
                  <div
                    key={participant.id || participant.email}
                    className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2"
                  >
                    <div className="grid size-8 place-items-center rounded-full bg-accent-primary/15 text-11 font-semibold text-accent-primary">
                      {(participant.user?.first_name || participant.name || participant.email)
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-12 font-medium text-primary">
                        {participant.user
                          ? `${participant.user.first_name} ${participant.user.last_name}`.trim()
                          : participant.name || participant.email}
                      </div>
                      <div className="truncate text-10 text-secondary">{participant.email}</div>
                    </div>
                    <div className="text-9 font-semibold text-tertiary uppercase">{participant.response_status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {meeting.agenda && (
            <div>
              <div className="mb-2 text-12 font-semibold text-primary">{t("calendar.agenda")}</div>
              <div className="rounded-lg border border-subtle bg-surface-2 p-4 text-12 whitespace-pre-wrap text-secondary">
                {meeting.agenda}
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-12 font-semibold text-primary">
                <Paperclip className="size-4 text-tertiary" /> {t("calendar.attachments")} · {attachments.length}
              </div>
              <label className="cursor-pointer rounded-md border border-subtle px-2.5 py-1.5 text-10 font-semibold text-secondary hover:bg-layer-1">
                {isUploading ? t("calendar.loading") : t("calendar.add_files")}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={isUploading}
                  onChange={(event) => {
                    if (event.target.files) void uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div
              className="space-y-1.5 rounded-lg border border-dashed border-subtle p-2"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files);
              }}
            >
              {attachments.length === 0 && (
                <div className="py-4 text-center text-10 text-tertiary">{t("calendar.add_files")}</div>
              )}
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                  <Paperclip className="size-3.5 text-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-11 font-medium text-primary">{attachment.name}</div>
                    <div className="text-9 text-tertiary">{Math.max(1, Math.round(attachment.size / 1024))} KB</div>
                  </div>
                  {meeting.can_manage && (
                    <label className="flex items-center gap-1 text-9 text-tertiary">
                      <input
                        type="checkbox"
                        checked={attachment.shared_with_guests}
                        onChange={async (event) => {
                          const updated = await calendarService.updateAttachment(
                            workspaceSlug,
                            meeting.id,
                            attachment.id,
                            event.target.checked
                          );
                          setAttachments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
                        }}
                      />
                      {t("calendar.share_with_guests")}
                    </label>
                  )}
                  <a
                    href={`${attachment.url}?disposition=attachment`}
                    className="rounded p-1.5 text-secondary hover:bg-layer-1"
                    aria-label={t("common.download")}
                  >
                    <Download className="size-3.5" />
                  </a>
                  {attachment.can_delete && (
                    <button
                      type="button"
                      className="rounded p-1.5 text-danger-primary hover:bg-danger-subtle"
                      onClick={async () => {
                        if (!window.confirm(t("calendar.delete_attachment_confirm"))) return;
                        await calendarService.deleteAttachment(workspaceSlug, meeting.id, attachment.id);
                        setAttachments((current) => current.filter((item) => item.id !== attachment.id));
                        onChanged();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-12 font-semibold text-primary">
              <MessageSquare className="size-4 text-tertiary" /> {t("calendar.comments")}
            </div>
            <div className="space-y-2">
              {comments.map((item) => (
                <div key={item.id} className="rounded-lg bg-surface-2 px-3 py-2">
                  <div className="text-10 font-semibold text-primary">
                    {item.user ? `${item.user.first_name} ${item.user.last_name}`.trim() : "GTS Tasks System"}
                  </div>
                  <div className="mt-1 text-11 whitespace-pre-wrap text-secondary">{item.body}</div>
                </div>
              ))}
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void submitComment();
                  }
                }}
                placeholder={t("calendar.comment_placeholder")}
                className="focus:border-accent-primary min-h-20 w-full resize-y rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-12 text-primary outline-none"
              />
              <div className="flex justify-end">
                <Button variant="secondary" disabled={!comment.trim() || isWorking} onClick={submitComment}>
                  {t("calendar.send_comment")}
                </Button>
              </div>
            </div>
          </div>

          {meeting.can_respond && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={meeting.my_response_status === "ACCEPTED" ? "primary" : "secondary"}
                disabled={isWorking}
                onClick={() => respond("ACCEPTED")}
              >
                {t("calendar.accept")}
              </Button>
              <Button
                variant={meeting.my_response_status === "TENTATIVE" ? "primary" : "secondary"}
                disabled={isWorking}
                onClick={() => respond("TENTATIVE")}
              >
                {t("calendar.tentative")}
              </Button>
              <Button
                variant={meeting.my_response_status === "DECLINED" ? "primary" : "secondary"}
                disabled={isWorking}
                onClick={() => respond("DECLINED")}
              >
                {t("calendar.decline")}
              </Button>
            </div>
          )}
          {meeting.can_manage && (
            <div className="space-y-3 border-t border-subtle pt-5">
              {(meeting.participant_details || []).some(
                (participant) => participant.user && participant.user.id !== meeting.organizer.id
              ) && (
                <div className="flex flex-wrap gap-2">
                  <CalendarSelect
                    value={newOrganizerId}
                    onChange={setNewOrganizerId}
                    placeholder={t("calendar.transfer_organizer")}
                    className="min-w-52 flex-1"
                    buttonClassName="bg-surface-2 text-11"
                    optionsClassName="min-w-72"
                    options={(meeting.participant_details || [])
                      .filter((participant) => participant.user && participant.user.id !== meeting.organizer.id)
                      .map((participant) => ({
                        value: participant.user?.id || "",
                        label:
                          `${participant.user?.first_name || ""} ${participant.user?.last_name || ""}`.trim() ||
                          participant.email,
                        description: participant.email,
                        icon: <UserRound className="size-3.5" />,
                      }))}
                  />
                  <Button variant="secondary" disabled={!newOrganizerId || isWorking} onClick={transferMeeting}>
                    {t("calendar.transfer")}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={onEdit} disabled={isWorking}>
                  {t("edit")}
                </Button>
                {meeting.status !== "CANCELLED" && (
                  <Button variant="secondary" onClick={cancelMeeting} disabled={isWorking}>
                    {t("calendar.cancel_meeting")}
                  </Button>
                )}
                {meeting.status !== "CANCELLED" && meeting.recurrence_rule && (
                  <Button variant="secondary" onClick={cancelOccurrence} disabled={isWorking}>
                    {t("calendar.cancel_occurrence")}
                  </Button>
                )}
                <Button variant="error-fill" onClick={deleteMeeting} disabled={isWorking}>
                  {t("calendar.delete_meeting")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function CalendarRoot({ workspaceSlug }: Props) {
  const { t, currentLocale } = useTranslation();
  const searchParams = useSearchParams();
  const requestedMeetingId = searchParams.get("meeting");
  const [view, setView] = useState<TCalendarView>("MONTH");
  const [cursor, setCursor] = useState(new Date());
  const [createDate, setCreateDate] = useState(new Date());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<DisplayMeeting | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<TMeeting | null>(null);
  const [openedQueryMeetingId, setOpenedQueryMeetingId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [organizerFilter, setOrganizerFilter] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showExternal, setShowExternal] = useState(true);
  const hasAppliedPreference = useRef(false);
  const range = useMemo(() => rangeForView(view, cursor), [cursor, view]);
  const dateLocale = localeCode(currentLocale);
  const rangeKey = `${range.start.toISOString()}:${range.end.toISOString()}`;

  const { data, error, isLoading, mutate } = useSWR(
    workspaceSlug ? `GTS_CALENDAR_${workspaceSlug}_${rangeKey}` : null,
    () => calendarService.getRange(workspaceSlug, range.start.toISOString(), range.end.toISOString(), true),
    { keepPreviousData: true, revalidateOnFocus: false }
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
  const { data: preferences } = useSWR("MY_CALENDAR_PREFERENCES", () => calendarService.getPreferences(), {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (!preferences || hasAppliedPreference.current) return;
    setView(preferences.default_view);
    const filters = preferences.filters || {};
    setProjectFilter(typeof filters.project_id === "string" ? filters.project_id : "");
    setOrganizerFilter(typeof filters.organizer_id === "string" ? filters.organizer_id : "");
    setShowCancelled(filters.show_cancelled === true);
    setShowExternal(filters.show_external !== false);
    hasAppliedPreference.current = true;
  }, [preferences]);

  useEffect(() => {
    if (!preferences || !hasAppliedPreference.current) return;
    const timer = window.setTimeout(() => {
      void calendarService.updatePreferences({
        filters: {
          ...preferences.filters,
          project_id: projectFilter,
          organizer_id: organizerFilter,
          show_cancelled: showCancelled,
          show_external: showExternal,
        },
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [organizerFilter, preferences, projectFilter, showCancelled, showExternal]);

  const displayMeetings = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.meetings.map((meeting) => [meeting.id, meeting]));
    return orderBy(
      data.occurrences
        .map((occurrence: TMeetingOccurrence) => {
          const meeting = byId.get(occurrence.meeting_id);
          if (!meeting) return null;
          return {
            ...meeting,
            occurrenceId: occurrence.occurrence_id,
            originalStartsAt: occurrence.original_starts_at,
            displayStartsAt: occurrence.starts_at,
            displayEndsAt: occurrence.ends_at,
          } satisfies DisplayMeeting;
        })
        .filter((meeting): meeting is DisplayMeeting => Boolean(meeting))
        .filter((meeting) => showCancelled || meeting.status !== "CANCELLED")
        .filter((meeting) => !projectFilter || meeting.project_id === projectFilter)
        .filter((meeting) => !organizerFilter || meeting.organizer.id === organizerFilter)
        .filter((meeting) => {
          const query = searchQuery.trim().toLocaleLowerCase();
          return !query || meeting.title.toLocaleLowerCase().includes(query);
        }),
      ["displayStartsAt"],
      ["asc"]
    );
  }, [data, organizerFilter, projectFilter, searchQuery, showCancelled]);

  useEffect(() => {
    if (!requestedMeetingId || requestedMeetingId === openedQueryMeetingId || !workspaceSlug) return;
    const inRange = displayMeetings.find((item) => item.id === requestedMeetingId);
    if (inRange) {
      setSelectedMeeting(inRange);
      setOpenedQueryMeetingId(requestedMeetingId);
      return;
    }
    void calendarService
      .getMeeting(workspaceSlug, requestedMeetingId)
      .then((item) => {
        setSelectedMeeting({
          ...item,
          occurrenceId: `${item.id}:${item.starts_at}`,
          originalStartsAt: item.starts_at,
          displayStartsAt: item.starts_at,
          displayEndsAt: item.ends_at,
        });
        setCursor(new Date(item.starts_at));
        return undefined;
      })
      .finally(() => setOpenedQueryMeetingId(requestedMeetingId));
  }, [displayMeetings, openedQueryMeetingId, requestedMeetingId, workspaceSlug]);

  const navigate = (direction: -1 | 1) => {
    if (view === "MONTH") setCursor((date) => (direction < 0 ? subMonths(date, 1) : addMonths(date, 1)));
    else if (view === "WEEK") setCursor((date) => (direction < 0 ? subWeeks(date, 1) : addWeeks(date, 1)));
    else setCursor((date) => addDays(date, direction * (view === "SCHEDULE" ? 30 : 1)));
  };

  const openCreate = (date = new Date()) => {
    if (isPastCalendarDate(date)) return;
    setCreateDate(date);
    setEditingMeeting(null);
    setIsCreateOpen(true);
  };

  const eventsForDay = (date: Date) =>
    displayMeetings.filter((meeting) => isSameDay(new Date(meeting.displayStartsAt), date));
  const externalForDay = (date: Date) =>
    showExternal
      ? (data?.external_events || []).filter((event: TCalendarExternalEvent) =>
          isSameDay(new Date(event.starts_at), date)
        )
      : [];

  const hideWeekends = preferences?.show_weekends === false;
  const visibleDay = (date: Date) => !hideWeekends || (date.getDay() !== 0 && date.getDay() !== 6);
  const monthDays = eachDayOfInterval({ start: range.start, end: range.end }).filter(visibleDay);
  const compactDays =
    view === "DAY" ? [cursor] : eachDayOfInterval({ start: range.start, end: range.end }).filter(visibleDay);

  const renderDayHeader = (date: Date) => {
    const holiday = holidayForDate(data?.holidays || [], date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    return (
      <div className="min-w-0">
        <div className={cn("font-mono text-10 uppercase", weekend ? "text-danger-primary" : "text-tertiary")}>
          {new Intl.DateTimeFormat(dateLocale, { weekday: "short" }).format(date)}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              "grid size-7 place-items-center rounded-full text-14 font-semibold",
              isToday(date) && "bg-accent-primary text-on-color",
              !isToday(date) && weekend && "text-danger-primary"
            )}
          >
            {format(date, "d")}
          </span>
          {holiday && (
            <span className="truncate rounded-full bg-danger-subtle px-2 py-0.5 text-9 text-danger-primary">
              {holiday.name}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="hidden size-10 place-items-center rounded-xl border border-subtle bg-surface-2 md:grid">
            <CalendarDays className="size-5 text-accent-primary" />
          </div>
          <div>
            <h1 className="text-18 font-semibold text-primary">{t("calendar.title")}</h1>
            <div className="text-11 text-secondary">{t("calendar.subtitle")}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-subtle bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t("calendar.previous_period")}
              className="grid size-7 place-items-center rounded-md text-secondary hover:bg-layer-1"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              className="min-w-20 rounded-md px-2 py-1 text-11 font-semibold text-primary hover:bg-layer-1"
            >
              {t("calendar.today")}
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              aria-label={t("calendar.next_period")}
              className="grid size-7 place-items-center rounded-md text-secondary hover:bg-layer-1"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex items-center rounded-lg border border-subtle bg-surface-2 p-1">
            {(["DAY", "WEEK", "MONTH", "SCHEDULE"] as TCalendarView[]).map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setView(item)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-11 font-semibold transition",
                  view === item ? "shadow-xs bg-surface-1 text-primary" : "text-secondary hover:text-primary"
                )}
              >
                {t(`calendar.${item.toLowerCase()}`)}
              </button>
            ))}
          </div>
          <Button
            variant={isFilterOpen ? "primary" : "secondary"}
            prependIcon={<SlidersHorizontal className="size-4" />}
            onClick={() => setIsFilterOpen((current) => !current)}
            className="!h-9"
          >
            {t("calendar.filters")}
          </Button>
          <Button
            variant="primary"
            prependIcon={<Plus className="size-4" />}
            onClick={() => openCreate()}
            className="!h-9"
          >
            {t("calendar.new_meeting")}
          </Button>
        </div>
      </div>

      {isFilterOpen && (
        <div className="grid gap-2 border-b border-subtle bg-surface-2 px-5 py-3 md:grid-cols-[minmax(180px,1fr)_220px_220px_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-tertiary" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("calendar.search")}
              className="focus:border-accent-primary h-9 w-full rounded-md border border-subtle bg-surface-1 pr-3 pl-9 text-12 text-primary outline-none"
            />
          </label>
          <CalendarSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              {
                value: "",
                label: t("calendar.all_projects"),
                icon: <BriefcaseBusiness className="size-3.5" />,
              },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
                description: project.identifier !== project.name ? project.identifier : undefined,
                icon: <BriefcaseBusiness className="size-3.5" />,
              })),
            ]}
            optionsClassName="min-w-64"
          />
          <CalendarSelect
            value={organizerFilter}
            onChange={setOrganizerFilter}
            options={[
              {
                value: "",
                label: t("calendar.all_organizers"),
                icon: <Users className="size-3.5" />,
              },
              ...workspaceMembers.map((member) => ({
                value: member.member.id,
                label: memberName(member),
                description: member.member.email,
                icon: <UserRound className="size-3.5" />,
              })),
            ]}
            optionsClassName="min-w-72"
          />
          <label className="flex items-center gap-2 px-2 text-11 text-secondary">
            <input type="checkbox" checked={showExternal} onChange={(event) => setShowExternal(event.target.checked)} />
            {t("calendar.external")}
          </label>
          <label className="flex items-center gap-2 px-2 text-11 text-secondary">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(event) => setShowCancelled(event.target.checked)}
            />
            {t("calendar.cancelled")}
          </label>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
        <h2 className="text-16 font-semibold text-primary capitalize">
          {view === "DAY"
            ? new Intl.DateTimeFormat(dateLocale, { dateStyle: "full" }).format(cursor)
            : view === "WEEK"
              ? `${new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short" }).format(range.start)} — ${new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", year: "numeric" }).format(range.end)}`
              : new Intl.DateTimeFormat(dateLocale, { month: "long", year: "numeric" }).format(cursor)}
        </h2>
        <div className="flex items-center gap-3 text-10 text-secondary">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-accent-primary" /> GTS
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-blue-500 size-2 rounded-full" /> {t("calendar.external")}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && !data ? (
          <div className="grid h-full place-items-center text-13 text-secondary">
            <div className="flex items-center gap-2">
              <RotateCcw className="size-4 animate-spin" /> {t("calendar.loading")}
            </div>
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center p-8 text-center text-13 text-danger-primary">
            {t("calendar.saving_error")}
          </div>
        ) : view === "MONTH" ? (
          <div className="min-w-[760px]">
            <div
              className={cn(
                "grid border-b border-subtle bg-surface-2/80",
                hideWeekends ? "grid-cols-5" : "grid-cols-7"
              )}
            >
              {eachDayOfInterval({ start: range.start, end: addDays(range.start, 6) })
                .filter(visibleDay)
                .map((date) => (
                  <div key={date.toISOString()} className="px-3 py-2 text-10 font-semibold text-secondary uppercase">
                    {new Intl.DateTimeFormat(dateLocale, { weekday: "short" }).format(date)}
                  </div>
                ))}
            </div>
            <div className={cn("grid", hideWeekends ? "grid-cols-5" : "grid-cols-7")}>
              {monthDays.map((date) => {
                const events = eventsForDay(date);
                const external = externalForDay(date);
                const holiday = holidayForDate(data?.holidays || [], date);
                const weekend = date.getDay() === 0 || date.getDay() === 6;
                const isPast = isPastCalendarDate(date);
                return (
                  <button
                    type="button"
                    key={date.toISOString()}
                    onClick={() => openCreate(date)}
                    aria-disabled={isPast}
                    className={cn(
                      "group min-h-[132px] border-r border-b border-subtle p-2 text-left align-top transition hover:bg-layer-transparent-hover",
                      weekend && "bg-danger-subtle/5",
                      holiday && holiday.kind !== "WORKDAY" && "bg-danger-subtle/10",
                      !isSameMonth(date, cursor) && "opacity-45",
                      isPast && "cursor-default hover:bg-transparent"
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          "font-mono grid size-6 place-items-center rounded-full text-11 font-semibold",
                          isToday(date) && "bg-accent-primary text-on-color",
                          !isToday(date) && weekend && "text-danger-primary"
                        )}
                      >
                        {format(date, "d")}
                      </span>
                      {!isPast && (
                        <Plus className="size-3.5 text-tertiary opacity-0 transition group-hover:opacity-100" />
                      )}
                    </div>
                    {holiday && (
                      <div
                        className={cn(
                          "mb-1 truncate rounded px-1.5 py-1 text-9 font-medium",
                          holiday.kind === "WORKDAY"
                            ? "bg-warning-subtle text-warning-primary"
                            : "bg-danger-subtle text-danger-primary"
                        )}
                      >
                        {holiday.name}
                      </div>
                    )}
                    <div className="space-y-1">
                      {events.slice(0, 3).map((meeting) => (
                        <MeetingChip
                          key={meeting.occurrenceId}
                          meeting={meeting}
                          onClick={() => setSelectedMeeting(meeting)}
                        />
                      ))}
                      {external.slice(0, Math.max(0, 3 - events.length)).map((event) => (
                        <div
                          key={event.id}
                          className="bg-blue-500/10 text-blue-500 flex items-center gap-1 rounded px-1.5 py-1 text-9"
                        >
                          <span className="bg-blue-500 size-1.5 rounded-full" />
                          <span className="truncate">{event.title}</span>
                        </div>
                      ))}
                      {events.length + external.length > 3 && (
                        <div className="px-1 text-9 text-tertiary">+{events.length + external.length - 3}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "grid min-h-full",
              view === "WEEK" ? `min-w-[860px] ${hideWeekends ? "grid-cols-5" : "grid-cols-7"}` : "grid-cols-1"
            )}
          >
            {compactDays.map((date) => {
              const events = eventsForDay(date);
              const external = externalForDay(date);
              const holiday = holidayForDate(data?.holidays || [], date);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const isPast = isPastCalendarDate(date);
              if (view === "SCHEDULE" && events.length === 0 && external.length === 0 && !holiday) return null;
              return (
                <section
                  key={date.toISOString()}
                  className={cn(
                    "min-h-[180px] border-r border-b border-subtle p-3",
                    weekend && "bg-danger-subtle/5",
                    holiday && holiday.kind !== "WORKDAY" && "bg-danger-subtle/10",
                    view === "SCHEDULE" && "grid grid-cols-[150px_1fr] gap-5 py-4"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openCreate(date)}
                    disabled={isPast}
                    className={cn("mb-3 w-full text-left", isPast && "cursor-default")}
                  >
                    {renderDayHeader(date)}
                  </button>
                  <div className="space-y-2">
                    {events.map((meeting) => (
                      <button
                        type="button"
                        key={meeting.occurrenceId}
                        onClick={() => setSelectedMeeting(meeting)}
                        className="shadow-xs hover:shadow-sm w-full rounded-lg border border-subtle bg-surface-1 p-3 text-left transition hover:border-strong"
                        style={{ borderLeftColor: getMeetingColor(meeting), borderLeftWidth: 3 }}
                      >
                        <div className="font-mono text-10 text-tertiary">
                          {format(new Date(meeting.displayStartsAt), "HH:mm")} —{" "}
                          {format(new Date(meeting.displayEndsAt), "HH:mm")}
                        </div>
                        <div className="mt-1 text-12 font-semibold text-primary">{meeting.title}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-9 text-secondary">
                          {meeting.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" />
                              {meeting.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Users className="size-3" />
                            {meeting.participant_details?.length || 0}
                          </span>
                          {meeting.meeting_url && <Link2 className="size-3" />}
                        </div>
                      </button>
                    ))}
                    {external.map((event) => (
                      <div key={event.id} className="border-blue-500/30 bg-blue-500/10 rounded-lg border p-3">
                        <div className="font-mono text-blue-500 text-10">
                          {format(new Date(event.starts_at), "HH:mm")}
                        </div>
                        <div className="mt-1 text-12 font-medium text-primary">
                          {event.title || t("calendar.external")}
                        </div>
                      </div>
                    ))}
                    {events.length === 0 && external.length === 0 && view !== "SCHEDULE" && (
                      <button
                        type="button"
                        onClick={() => openCreate(date)}
                        disabled={isPast}
                        className={cn(
                          "grid min-h-24 w-full place-items-center rounded-lg border border-dashed border-subtle text-11 text-tertiary",
                          isPast
                            ? "cursor-not-allowed opacity-40"
                            : "hover:border-accent-primary hover:text-accent-primary"
                        )}
                      >
                        <Plus className="size-4" />
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
            {view === "SCHEDULE" && displayMeetings.length === 0 && (data?.external_events.length || 0) === 0 && (
              <div className="grid min-h-80 place-items-center text-13 text-secondary">{t("calendar.no_events")}</div>
            )}
          </div>
        )}
      </div>

      <MeetingFormModal
        workspaceSlug={workspaceSlug}
        isOpen={isCreateOpen}
        initialDate={createDate}
        projects={projects}
        workspaceMembers={workspaceMembers}
        meeting={editingMeeting}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingMeeting(null);
        }}
        onSaved={() => {
          void mutate();
          setToast({ type: TOAST_TYPE.SUCCESS, title: t("toast.success"), message: t("calendar.save") });
        }}
      />
      {selectedMeeting && (
        <MeetingDetails
          meeting={selectedMeeting}
          workspaceSlug={workspaceSlug}
          onClose={() => setSelectedMeeting(null)}
          onEdit={() => {
            setEditingMeeting(selectedMeeting);
            setCreateDate(new Date(selectedMeeting.displayStartsAt));
            setSelectedMeeting(null);
            setIsCreateOpen(true);
          }}
          onChanged={() => {
            void mutate();
            void calendarService
              .getMeeting(workspaceSlug, selectedMeeting.id)
              .then((freshMeeting) =>
                setSelectedMeeting((current) =>
                  current?.id === freshMeeting.id
                    ? {
                        ...freshMeeting,
                        occurrenceId: current.occurrenceId,
                        originalStartsAt: current.originalStartsAt,
                        displayStartsAt: current.displayStartsAt,
                        displayEndsAt: current.displayEndsAt,
                      }
                    : current
                )
              )
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
