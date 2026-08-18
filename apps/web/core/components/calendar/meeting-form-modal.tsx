/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  Link2,
  LockKeyhole,
  MapPin,
  Paperclip,
  Plus,
  Radio,
  Repeat2,
  Search,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TCalendarAvailabilityResponse,
  IWorkspaceMember,
  TMeeting,
  TMeetingAttendanceMode,
  TMeetingParticipant,
  TMeetingPayload,
  TMeetingType,
  TPartialProject,
} from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { DateDropdown } from "@/components/dropdowns/date";
import calendarService from "@/services/calendar.service";
import projectMemberService from "@/services/project/project-member.service";
import { getCalendarErrorMessage } from "./calendar-error";
import { CalendarSelect } from "./calendar-select";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  initialDate: Date;
  projects: TPartialProject[];
  workspaceMembers: IWorkspaceMember[];
  meeting?: TMeeting | null;
  prefill?: {
    title: string;
    projectId: string;
    issueId: string;
    meetingTypeId?: string | null;
    participants: TMeetingParticipant[];
  } | null;
  onClose: () => void;
  onSaved: () => void;
};

type FormState = {
  title: string;
  projectId: string;
  meetingTypeId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  allDay: boolean;
  attendanceMode: TMeetingAttendanceMode;
  meetingUrl: string;
  location: string;
  description: string;
  agenda: string;
  visibility: "PROJECT" | "RESTRICTED" | "PERSONAL";
  repeat: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  repeatUntil: string;
  reminderMinutes: number[];
};

const dateTimeValue = (value: Date | string) => format(new Date(value), "yyyy-MM-dd'T'HH:mm");

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

const isPresetDuration = (value: number) => DURATION_OPTIONS.some((option) => option === value);

const durationBetween = (start: Date | string, end: Date | string) =>
  Math.max(5, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));

const roundToNextQuarterHour = (value = new Date()) => {
  const rounded = new Date(value);
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % 15;
  rounded.setMinutes(rounded.getMinutes() + (remainder === 0 ? 15 : 15 - remainder));
  return rounded;
};

const startWithDuration = (startsAt: string, durationMinutes: number) =>
  dateTimeValue(new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000));

const memberName = (member: IWorkspaceMember) => {
  const firstName = member.member?.first_name || member.first_name || "";
  const lastName = member.member?.last_name || member.last_name || "";
  return `${firstName} ${lastName}`.trim() || member.member?.email || member.email || "—";
};

const memberEmail = (member: IWorkspaceMember) => member.member?.email || member.email || "";

const initialForm = (initialDate: Date, meeting?: TMeeting | null, prefill?: Props["prefill"]): FormState => {
  let start = meeting ? new Date(meeting.starts_at) : new Date(initialDate);
  if (!meeting) {
    if (start < new Date()) start = new Date();
    start = roundToNextQuarterHour(start);
  }
  const end = meeting ? new Date(meeting.ends_at) : new Date(start.getTime() + 30 * 60 * 1000);
  const durationMinutes = durationBetween(start, end);
  const recurrence = meeting?.recurrence_rule?.toUpperCase() || "";
  return {
    title: meeting?.title || prefill?.title || "",
    projectId: meeting?.project_id || prefill?.projectId || "",
    meetingTypeId: meeting?.meeting_type_id || prefill?.meetingTypeId || "",
    startsAt: dateTimeValue(start),
    endsAt: dateTimeValue(end),
    durationMinutes,
    allDay: meeting?.all_day || false,
    attendanceMode: meeting?.attendance_mode || "ONLINE",
    meetingUrl: meeting?.meeting_url || "",
    location: meeting?.location || "",
    description: meeting?.description || "",
    agenda: meeting?.agenda || "",
    visibility: meeting?.visibility || "PERSONAL",
    repeat: recurrence.includes("DAILY")
      ? "DAILY"
      : recurrence.includes("WEEKLY")
        ? "WEEKLY"
        : recurrence.includes("MONTHLY")
          ? "MONTHLY"
          : recurrence.includes("YEARLY")
            ? "YEARLY"
            : "NONE",
    repeatUntil: meeting?.recurrence_until ? format(new Date(meeting.recurrence_until), "yyyy-MM-dd") : "",
    reminderMinutes: meeting?.reminders?.map((item) => item.minutes_before) || [15],
  };
};

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <div className="mb-1.5 text-11 font-semibold tracking-wide text-secondary uppercase">{children}</div>
);

const inputClass =
  "h-9 w-full rounded-md border border-subtle bg-surface-2 px-3 text-13 text-primary outline-none transition focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15";

export function MeetingFormModal(props: Props) {
  const { workspaceSlug, isOpen, initialDate, projects, workspaceMembers, meeting, prefill, onClose, onSaved } = props;
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => initialForm(initialDate, meeting, prefill));
  const [meetingTypes, setMeetingTypes] = useState<TMeetingType[]>([]);
  const [projectMemberIds, setProjectMemberIds] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Map<string, "REQUIRED" | "OPTIONAL">>(new Map());
  const [guestEmail, setGuestEmail] = useState("");
  const [externalGuests, setExternalGuests] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<TCalendarAvailabilityResponse["suggested_slots"]>([]);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [participantQuery, setParticipantQuery] = useState("");
  const [isCustomDuration, setIsCustomDuration] = useState(
    () => !isPresetDuration(initialForm(initialDate, meeting, prefill).durationMinutes)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const nextForm = initialForm(initialDate, meeting, prefill);
    setForm(nextForm);
    setIsCustomDuration(!isPresetDuration(nextForm.durationMinutes));
    setExternalGuests(meeting?.participant_details?.filter((item) => !item.user).map((item) => item.email) || []);
    setParticipants(
      new Map(
        (meeting?.participant_details || prefill?.participants || [])
          .filter((item) => item.user)
          .map((item) => [item.user?.id || "", item.role] as const)
          .filter(([id]) => Boolean(id))
      )
    );
    setHasConflict(false);
    setSuggestedSlots([]);
    setPendingFiles([]);
    setParticipantQuery("");
    setSubmitError(null);
  }, [initialDate, isOpen, meeting, prefill]);

  useEffect(() => {
    if (!isOpen || !form.projectId) {
      setMeetingTypes([]);
      setProjectMemberIds(new Set());
      return;
    }
    void Promise.all([
      calendarService.getMeetingTypes(workspaceSlug, form.projectId),
      projectMemberService.fetchProjectMembers(workspaceSlug, form.projectId),
    ]).then(([types, memberships]) => {
      setMeetingTypes(types);
      setProjectMemberIds(new Set(memberships.map((item) => item.member)));
      const defaultType = types.find((item) => item.is_default);
      if (defaultType)
        setForm((current) => ({
          ...current,
          meetingTypeId: current.meetingTypeId || defaultType.id,
          attendanceMode: meeting ? current.attendanceMode : defaultType.default_attendance_mode,
          visibility: current.visibility === "PERSONAL" ? "PROJECT" : current.visibility,
          endsAt:
            meeting || current.meetingTypeId
              ? current.endsAt
              : startWithDuration(current.startsAt, defaultType.default_duration_minutes),
          durationMinutes:
            meeting || current.meetingTypeId ? current.durationMinutes : defaultType.default_duration_minutes,
          reminderMinutes: meeting || current.meetingTypeId ? current.reminderMinutes : defaultType.default_reminders,
        }));
      if (defaultType && !meeting && !prefill?.meetingTypeId)
        setIsCustomDuration(!isPresetDuration(defaultType.default_duration_minutes));
      return undefined;
    });
  }, [form.projectId, isOpen, meeting, prefill?.meetingTypeId, workspaceSlug]);

  const availableMembers = useMemo(
    () =>
      workspaceMembers.filter(
        (member) =>
          member.is_active !== false &&
          member.member?.is_active !== false &&
          (!form.projectId || projectMemberIds.has(member.member?.id || "")) &&
          Boolean(memberEmail(member))
      ),
    [form.projectId, projectMemberIds, workspaceMembers]
  );

  const visibleMembers = useMemo(() => {
    const query = participantQuery.trim().toLocaleLowerCase();
    if (!query) return availableMembers;
    return availableMembers.filter((member) =>
      `${memberName(member)} ${memberEmail(member)}`.toLocaleLowerCase().includes(query)
    );
  }, [availableMembers, participantQuery]);

  useEffect(() => {
    if (!isOpen || participants.size === 0 || !form.startsAt || !form.endsAt) {
      setHasConflict(false);
      setSuggestedSlots([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const requiredIds = [...participants.entries()].filter(([, role]) => role === "REQUIRED").map(([id]) => id);
      const optionalIds = [...participants.entries()].filter(([, role]) => role === "OPTIONAL").map(([id]) => id);
      const startsAt = new Date(form.startsAt);
      const endsAt = new Date(form.endsAt);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return;
      setIsCheckingAvailability(true);
      try {
        const result = await calendarService.getAvailability(workspaceSlug, {
          user_ids: [...participants.keys()],
          required_user_ids: requiredIds,
          optional_user_ids: optionalIds,
          start: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          duration_minutes: Math.max(5, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)),
          meeting_id: meeting?.id,
          find_slots: true,
        });
        setHasConflict(
          requiredIds.some((userId) =>
            (result.busy[userId] || []).some(
              (item) => new Date(item.starts_at) < endsAt && new Date(item.ends_at) > startsAt
            )
          )
        );
        setSuggestedSlots(result.suggested_slots.slice(0, 4));
      } catch {
        setSuggestedSlots([]);
      } finally {
        setIsCheckingAvailability(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [form.endsAt, form.startsAt, isOpen, meeting?.id, participants, workspaceSlug]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSubmitError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateStart = (date: Date | string, time: string) => {
    const dateValue = typeof date === "string" ? date.slice(0, 10) : format(date, "yyyy-MM-dd");
    let nextStart = new Date(`${dateValue}T${time || "00:00"}`);
    if (!meeting && nextStart < new Date()) nextStart = roundToNextQuarterHour();
    const nextStartsAt = dateTimeValue(nextStart);
    setForm((current) => ({
      ...current,
      startsAt: nextStartsAt,
      endsAt: startWithDuration(nextStartsAt, current.durationMinutes),
    }));
  };

  const updateDuration = (durationMinutes: number) => {
    const normalizedDuration = Math.min(1440, Math.max(5, Math.round(durationMinutes || 0)));
    setForm((current) => ({
      ...current,
      durationMinutes: normalizedDuration,
      endsAt: startWithDuration(current.startsAt, normalizedDuration),
    }));
  };

  const toggleParticipant = (userId: string) => {
    setParticipants((current) => {
      const next = new Map(current);
      if (next.has(userId)) next.delete(userId);
      else next.set(userId, "REQUIRED");
      return next;
    });
  };

  const addGuest = () => {
    const email = guestEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || externalGuests.includes(email)) return;
    setExternalGuests((current) => [...current, email]);
    setGuestEmail("");
  };

  const participantPayload = (): TMeetingParticipant[] => {
    const internal = availableMembers
      .filter((member) => participants.has(member.member.id))
      .map((member) => ({
        user_id: member.member.id,
        email: memberEmail(member),
        name: memberName(member),
        role: participants.get(member.member.id) || "REQUIRED",
        source: "EXPLICIT",
      })) satisfies TMeetingParticipant[];
    const external = externalGuests.map(
      (email) =>
        ({ email, name: email.split("@")[0], role: "REQUIRED", source: "EXPLICIT" }) satisfies TMeetingParticipant
    );
    return [...internal, ...external];
  };

  const recurrenceUntil = form.repeatUntil ? new Date(`${form.repeatUntil}T23:59:59`).toISOString() : null;
  const recurrenceRule =
    form.repeat === "NONE"
      ? ""
      : `RRULE:FREQ=${form.repeat}${recurrenceUntil ? `;UNTIL=${recurrenceUntil.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}` : ""}`;

  const buildPayload = (): TMeetingPayload => {
    let startsAt = new Date(form.startsAt);
    let endsAt = new Date(form.endsAt);
    if (form.allDay) {
      startsAt = startOfDay(startsAt);
      endsAt = startOfDay(endsAt);
      if (endsAt <= startsAt) endsAt = addDays(startsAt, 1);
    }
    return {
      project_id: form.projectId || null,
      issue_id: meeting?.issue_id || prefill?.issueId || null,
      meeting_type_id: form.meetingTypeId || null,
      title: form.title.trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: form.allDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      location: form.location.trim(),
      attendance_mode: form.attendanceMode,
      meeting_url: form.meetingUrl.trim(),
      google_meet_open_access: true,
      visibility: form.projectId ? form.visibility : "PERSONAL",
      description: form.description.trim(),
      agenda: form.agenda.trim(),
      recurrence_rule: recurrenceRule,
      recurrence_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      recurrence_until: recurrenceUntil,
      participants: participantPayload(),
      reminder_minutes: form.reminderMinutes,
    };
  };

  const submit = async () => {
    setSubmitError(null);
    const startsAt = new Date(form.startsAt);
    if (
      !form.title.trim() ||
      !form.startsAt ||
      !form.endsAt ||
      form.durationMinutes < 5 ||
      new Date(form.endsAt) <= startsAt ||
      (!meeting && !form.allDay && startsAt < new Date())
    ) {
      const message = t("calendar.saving_error");
      setSubmitError(message);
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message });
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildPayload();
      const savedMeeting = meeting
        ? await calendarService.updateMeeting(workspaceSlug, meeting.id, payload)
        : await calendarService.createMeeting(workspaceSlug, payload);
      const uploadResults = await Promise.allSettled(
        pendingFiles.map((file) => calendarService.uploadAttachment(workspaceSlug, savedMeeting.id, file))
      );
      const failedUploads = uploadResults.filter((result) => result.status === "rejected").length;
      if (failedUploads > 0) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: t("calendar.attachment_upload_failed", { count: failedUploads }),
        });
      }
      onSaved();
      onClose();
    } catch (error) {
      const message = getCalendarErrorMessage(error, t, t("calendar.saving_error"));
      setSubmitError(message);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={onClose}
      width={EModalWidth.XXL}
      position={EModalPosition.TOP}
      className="!max-w-[920px] overflow-hidden !bg-surface-1"
    >
      <div data-prevent-outside-click className="flex max-h-[88vh] flex-col bg-surface-1">
        <div className="flex items-center justify-between border-b border-subtle px-5 py-4">
          <div>
            <h2 className="text-18 font-semibold text-primary">
              {meeting ? t("calendar.edit_meeting") : t("calendar.new_meeting")}
            </h2>
            <p className="mt-0.5 text-12 text-secondary">{t("calendar.subtitle")}</p>
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

        {submitError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-5 mt-4 flex items-start gap-3 rounded-lg border border-danger-subtle bg-danger-subtle/10 px-4 py-3"
          >
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-danger-primary" />
            <div className="min-w-0">
              <p className="text-12 font-semibold text-danger-primary">{t("calendar.save_failed_title")}</p>
              <p className="mt-0.5 text-11 whitespace-pre-line text-danger-primary">{submitError}</p>
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_300px]">
          <div className="space-y-5 p-5">
            <div>
              <FieldLabel>{t("calendar.title_field")}</FieldLabel>
              <input
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                className={`${inputClass} text-15 h-11 font-medium`}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>{t("calendar.project_field")}</FieldLabel>
                <CalendarSelect
                  value={form.projectId}
                  onChange={(value) => {
                    update("projectId", value);
                    update("meetingTypeId", "");
                    update("visibility", value ? "PROJECT" : "PERSONAL");
                    setParticipants(new Map());
                  }}
                  options={[
                    {
                      value: "",
                      label: t("calendar.personal"),
                      icon: <UserRound className="size-3.5" />,
                    },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: project.name,
                      description: project.identifier !== project.name ? project.identifier : undefined,
                      icon: <BriefcaseBusiness className="size-3.5" />,
                    })),
                  ]}
                  buttonClassName="bg-surface-2"
                  optionsClassName="min-w-72"
                />
              </div>
              <div>
                <FieldLabel>{t("calendar.type")}</FieldLabel>
                <CalendarSelect
                  value={form.meetingTypeId}
                  onChange={(value) => {
                    const selectedType = meetingTypes.find((item) => item.id === value);
                    const durationMinutes = selectedType?.default_duration_minutes || form.durationMinutes;
                    setIsCustomDuration(!isPresetDuration(durationMinutes));
                    setForm((current) => ({
                      ...current,
                      meetingTypeId: value,
                      attendanceMode: selectedType?.default_attendance_mode || current.attendanceMode,
                      durationMinutes,
                      endsAt: selectedType ? startWithDuration(current.startsAt, durationMinutes) : current.endsAt,
                      reminderMinutes: selectedType?.default_reminders || current.reminderMinutes,
                    }));
                  }}
                  disabled={!form.projectId}
                  options={[
                    { value: "", label: "—", icon: <CalendarClock className="size-3.5" /> },
                    ...meetingTypes.map((item) => ({
                      value: item.id,
                      label: item.name,
                      description: `${item.default_duration_minutes} мин`,
                      icon: <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />,
                    })),
                  ]}
                  buttonClassName="bg-surface-2"
                  optionsClassName="min-w-64"
                />
              </div>
            </div>

            <div className="rounded-lg border border-subtle bg-surface-2 p-4">
              <div className="mb-3 flex items-center gap-2 text-13 font-semibold text-primary">
                <CalendarClock className="size-4 text-accent-primary" />
                {t("calendar.starts")}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className={form.allDay ? "sm:col-span-3" : undefined}>
                  <FieldLabel>{t("calendar.date")}</FieldLabel>
                  <DateDropdown
                    value={form.startsAt}
                    onChange={(date) => {
                      if (date) updateStart(date, form.startsAt.slice(11, 16));
                    }}
                    minDate={meeting ? undefined : startOfDay(new Date())}
                    placeholder={t("calendar.date")}
                    buttonVariant="border-with-text"
                    buttonContainerClassName="w-full"
                    className="h-9 w-full"
                    buttonClassName="!h-9 !rounded-md !border-subtle !bg-surface-2 !px-3"
                    optionsClassName="!z-[90]"
                    icon={<CalendarDays className="size-3.5 flex-shrink-0 text-tertiary" />}
                    isClearable={false}
                    showTooltip={false}
                  />
                </div>
                {!form.allDay && (
                  <div>
                    <FieldLabel>{t("calendar.time")}</FieldLabel>
                    <input
                      type="time"
                      step={300}
                      min={
                        !meeting && form.startsAt.slice(0, 10) === format(new Date(), "yyyy-MM-dd")
                          ? format(roundToNextQuarterHour(), "HH:mm")
                          : undefined
                      }
                      value={form.startsAt.slice(11, 16)}
                      onChange={(event) => updateStart(form.startsAt, event.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}
                {!form.allDay && (
                  <div>
                    <FieldLabel>{t("calendar.duration")}</FieldLabel>
                    <div className={isCustomDuration ? "space-y-2" : undefined}>
                      <CalendarSelect
                        value={isCustomDuration ? "CUSTOM" : String(form.durationMinutes)}
                        onChange={(value) => {
                          if (value === "CUSTOM") {
                            setIsCustomDuration(true);
                            return;
                          }
                          setIsCustomDuration(false);
                          updateDuration(Number(value));
                        }}
                        options={[
                          ...DURATION_OPTIONS.map((minutes) => ({
                            value: String(minutes),
                            label: t("calendar.duration_minutes", { count: minutes }),
                            icon: <CalendarClock className="size-3.5" />,
                          })),
                          {
                            value: "CUSTOM",
                            label: t("calendar.custom_duration"),
                            icon: <Plus className="size-3.5" />,
                          },
                        ]}
                        className="min-w-0"
                        buttonClassName="bg-surface-2"
                        optionsClassName="min-w-52"
                      />
                      {isCustomDuration && (
                        <input
                          type="number"
                          min={5}
                          max={1440}
                          step={5}
                          value={form.durationMinutes}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => updateDuration(Number(event.target.value))}
                          aria-label={t("calendar.duration_minutes_label")}
                          className={`${inputClass} px-3`}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
              <label className="mt-3 flex items-center gap-2 text-12 text-secondary">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(event) => update("allDay", event.target.checked)}
                />
                {t("calendar.all_day")}
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>{t("calendar.location")}</FieldLabel>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute top-2.5 left-3 size-4 text-tertiary" />
                  <input
                    value={form.location}
                    onChange={(event) => update("location", event.target.value)}
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </div>
              <div>
                <FieldLabel>{t("calendar.online")}</FieldLabel>
                <CalendarSelect
                  value={form.attendanceMode}
                  onChange={(value) => update("attendanceMode", value as TMeetingAttendanceMode)}
                  options={[
                    { value: "ONLINE", label: t("calendar.online"), icon: <Video className="size-3.5" /> },
                    { value: "MIXED", label: t("calendar.mixed"), icon: <Radio className="size-3.5" /> },
                    { value: "OFFLINE", label: t("calendar.offline"), icon: <MapPin className="size-3.5" /> },
                  ]}
                  buttonClassName="bg-surface-2"
                />
              </div>
            </div>
            {form.attendanceMode !== "OFFLINE" && (
              <div>
                <FieldLabel>{t("calendar.manual_link")}</FieldLabel>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute top-2.5 left-3 size-4 text-tertiary" />
                  <input
                    type="url"
                    value={form.meetingUrl}
                    onChange={(event) => update("meetingUrl", event.target.value)}
                    placeholder={t("calendar.auto_meet")}
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </div>
            )}

            <div>
              <FieldLabel>{t("calendar.description")}</FieldLabel>
              <textarea
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                className={`${inputClass} h-24 resize-y py-2`}
              />
            </div>
            <div>
              <FieldLabel>{t("calendar.agenda")}</FieldLabel>
              <textarea
                value={form.agenda}
                onChange={(event) => update("agenda", event.target.value)}
                className={`${inputClass} h-20 resize-y py-2`}
              />
            </div>
            <div>
              <FieldLabel>{t("calendar.attachments")}</FieldLabel>
              <label
                className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-subtle bg-surface-2 px-4 py-3 text-11 text-secondary hover:border-strong hover:text-primary"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setPendingFiles((current) => [...current, ...Array.from(event.dataTransfer.files)]);
                }}
              >
                <Paperclip className="size-4" /> {t("calendar.add_files")}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files)
                      setPendingFiles((current) => [...current, ...Array.from(event.target.files || [])]);
                    event.target.value = "";
                  }}
                />
              </label>
              {pendingFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pendingFiles.map((file, index) => (
                    <button
                      type="button"
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      onClick={() =>
                        setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                      className="flex max-w-full items-center gap-1 rounded-full bg-layer-1 px-2 py-1 text-10 text-secondary"
                    >
                      <span className="truncate">{file.name}</span>
                      <X className="size-3 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5 border-t border-subtle bg-surface-2/70 p-5 lg:border-t-0 lg:border-l">
            <div>
              <div className="mb-3 flex items-center gap-2 text-13 font-semibold text-primary">
                <Users className="size-4 text-accent-primary" />
                {t("calendar.participants")}
              </div>
              <label className="relative mb-2 block">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-tertiary" />
                <input
                  value={participantQuery}
                  onChange={(event) => setParticipantQuery(event.target.value)}
                  placeholder={t("calendar.participant_search")}
                  className={`${inputClass} pl-9`}
                />
              </label>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-subtle bg-surface-1 p-1.5">
                {visibleMembers.map((member) => {
                  const userId = member.member.id;
                  const selected = participants.has(userId);
                  return (
                    <div key={userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer-1">
                      <button
                        type="button"
                        onClick={() => toggleParticipant(userId)}
                        className={`grid size-5 flex-shrink-0 place-items-center rounded border ${
                          selected ? "border-accent-primary bg-accent-primary text-on-color" : "border-subtle"
                        }`}
                      >
                        {selected && <Check className="size-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleParticipant(userId)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-12 font-medium text-primary">{memberName(member)}</div>
                        <div className="truncate text-10 text-tertiary">{memberEmail(member)}</div>
                      </button>
                      {selected && (
                        <button
                          type="button"
                          onClick={() =>
                            setParticipants((current) => {
                              const next = new Map(current);
                              next.set(userId, current.get(userId) === "REQUIRED" ? "OPTIONAL" : "REQUIRED");
                              return next;
                            })
                          }
                          className="rounded bg-layer-1 px-1.5 py-1 text-9 font-semibold text-secondary uppercase"
                        >
                          {participants.get(userId) === "REQUIRED" ? t("calendar.required") : t("calendar.optional")}
                        </button>
                      )}
                    </div>
                  );
                })}
                {visibleMembers.length === 0 && (
                  <div className="px-2 py-4 text-center text-10 text-tertiary">
                    {t("calendar.no_participants_found")}
                  </div>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="email"
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGuest();
                    }
                  }}
                  placeholder={t("calendar.external_email")}
                  className={`${inputClass} min-w-0`}
                />
                <Button
                  variant="secondary"
                  onClick={addGuest}
                  aria-label={t("calendar.add_guest")}
                  className="!grid !size-9 !min-w-9 !place-items-center !p-0"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              {externalGuests.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {externalGuests.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setExternalGuests((current) => current.filter((item) => item !== email))}
                      className="flex items-center gap-1 rounded-full bg-layer-1 px-2 py-1 text-10 text-secondary"
                    >
                      {email} <X className="size-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {form.projectId && (
              <div>
                <FieldLabel>{t("calendar.visibility")}</FieldLabel>
                <CalendarSelect
                  value={form.visibility}
                  onChange={(value) => update("visibility", value as FormState["visibility"])}
                  options={[
                    {
                      value: "PROJECT",
                      label: t("calendar.visibility_project"),
                      icon: <Users className="size-3.5" />,
                    },
                    {
                      value: "RESTRICTED",
                      label: t("calendar.visibility_restricted"),
                      icon: <LockKeyhole className="size-3.5" />,
                    },
                  ]}
                />
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center gap-2 text-11 font-semibold tracking-wide text-secondary uppercase">
                <Repeat2 className="size-4 text-tertiary" />
                {t("calendar.repeat")}
              </div>
              <CalendarSelect
                value={form.repeat}
                onChange={(value) => update("repeat", value as FormState["repeat"])}
                options={[
                  { value: "NONE", label: t("calendar.repeat_none"), icon: <X className="size-3.5" /> },
                  { value: "DAILY", label: t("calendar.repeat_daily"), icon: <Repeat2 className="size-3.5" /> },
                  { value: "WEEKLY", label: t("calendar.repeat_weekly"), icon: <CalendarRange className="size-3.5" /> },
                  {
                    value: "MONTHLY",
                    label: t("calendar.repeat_monthly"),
                    icon: <CalendarRange className="size-3.5" />,
                  },
                  { value: "YEARLY", label: t("calendar.repeat_yearly"), icon: <CalendarRange className="size-3.5" /> },
                ]}
              />
              {form.repeat !== "NONE" && (
                <div className="mt-2">
                  <FieldLabel>{t("calendar.repeat_until")}</FieldLabel>
                  <DateDropdown
                    value={form.repeatUntil}
                    onChange={(date) => update("repeatUntil", date ? format(date, "yyyy-MM-dd") : "")}
                    minDate={startOfDay(new Date(form.startsAt))}
                    placeholder={t("calendar.repeat_until")}
                    buttonVariant="border-with-text"
                    buttonContainerClassName="w-full"
                    className="h-9 w-full"
                    buttonClassName="!h-9 !rounded-md !border-subtle !bg-surface-2 !px-3"
                    optionsClassName="!z-[90]"
                    icon={<CalendarRange className="size-3.5 flex-shrink-0 text-tertiary" />}
                    isClearable
                    showTooltip={false}
                  />
                </div>
              )}
            </div>

            <div>
              <FieldLabel>{t("calendar.reminders")}</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {[0, 5, 15, 30, 60, 1440].map((minutes) => {
                  const selected = form.reminderMinutes.includes(minutes);
                  return (
                    <button
                      type="button"
                      key={minutes}
                      onClick={() =>
                        update(
                          "reminderMinutes",
                          selected
                            ? form.reminderMinutes.filter((item) => item !== minutes)
                            : [...form.reminderMinutes, minutes]
                        )
                      }
                      className={`rounded-md border px-2 py-1 text-10 ${
                        selected
                          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                          : "border-subtle text-secondary"
                      }`}
                    >
                      {minutes === 0
                        ? t("calendar.reminder_at_start")
                        : minutes < 60
                          ? t("calendar.reminder_minutes", { count: minutes })
                          : minutes === 60
                            ? t("calendar.reminder_hour")
                            : t("calendar.reminder_day")}
                    </button>
                  );
                })}
              </div>
            </div>

            {hasConflict && (
              <div className="rounded-md border border-warning-subtle bg-warning-subtle/10 p-3 text-11 text-warning-primary">
                {t("calendar.conflict")}
              </div>
            )}
            {(isCheckingAvailability || suggestedSlots.length > 0) && (
              <div className="rounded-lg border border-subtle bg-surface-1 p-3">
                <div className="text-11 font-semibold text-primary">{t("calendar.suggested_times")}</div>
                {isCheckingAvailability ? (
                  <div className="mt-2 text-10 text-tertiary">{t("calendar.checking_availability")}</div>
                ) : (
                  <div className="mt-2 space-y-1">
                    {suggestedSlots.map((slot) => (
                      <button
                        type="button"
                        key={slot.starts_at}
                        onClick={() => {
                          const durationMinutes = durationBetween(slot.starts_at, slot.ends_at);
                          update("startsAt", dateTimeValue(slot.starts_at));
                          update("endsAt", dateTimeValue(slot.ends_at));
                          update("durationMinutes", durationMinutes);
                          setIsCustomDuration(!isPresetDuration(durationMinutes));
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-10 text-secondary hover:bg-layer-1 hover:text-primary"
                      >
                        <span>
                          {new Intl.DateTimeFormat(undefined, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(slot.starts_at))}
                        </span>
                        <span>
                          {participants.size - slot.optional_conflicts.length}/{participants.size}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="rounded-lg border border-subtle bg-surface-1 p-3 text-11 text-secondary">
              <div className="mb-1 flex items-center gap-2 font-semibold text-primary">
                <Video className="size-4 text-accent-primary" /> GTS Meetings
              </div>
              {t("calendar.invitation_note")}
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-between border-t border-subtle bg-surface-1 px-5 py-4">
          <div className="text-11 text-secondary">
            {form.projectId ? t("calendar.project") : t("calendar.personal")}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} loading={isSaving}>
              {t("calendar.save")}
            </Button>
          </div>
        </div>
      </div>
    </ModalCore>
  );
}
