/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, CalendarClock, MapPin, Pencil, Plus, Radio, Trash2, Video } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TMeetingAttendanceMode, TMeetingType } from "@plane/types";
import { CalendarSelect } from "@/components/calendar/calendar-select";
import calendarService from "@/services/calendar.service";

type Props = { workspaceSlug: string; projectId: string };

type FormState = {
  id?: string;
  name: string;
  color: string;
  icon: string;
  default_duration_minutes: number;
  default_reminders: number[];
  default_attendance_mode: TMeetingAttendanceMode;
  is_default: boolean;
};

const emptyForm: FormState = {
  name: "",
  color: "#22A06B",
  icon: "calendar",
  default_duration_minutes: 30,
  default_reminders: [15],
  default_attendance_mode: "ONLINE",
  is_default: false,
};

const fieldClass =
  "h-9 w-full rounded-md border border-subtle bg-surface-1 px-3 text-12 text-primary outline-none focus:border-accent-primary";

export function MeetingTypesSettings({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { data: meetingTypes = [], mutate } = useSWR(
    workspaceSlug && projectId ? `MEETING_TYPES_${workspaceSlug}_${projectId}` : null,
    () => calendarService.getMeetingTypes(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ordered, setOrdered] = useState<TMeetingType[]>([]);

  useEffect(() => setOrdered(meetingTypes), [meetingTypes]);

  const save = async () => {
    if (!form.name.trim()) return;
    setIsSaving(true);
    try {
      if (form.id) await calendarService.updateMeetingType(workspaceSlug, projectId, form.id, form);
      else await calendarService.createMeetingType(workspaceSlug, projectId, form);
      setForm(emptyForm);
      setIsEditing(false);
      await mutate();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("toast.success") });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error") });
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (meetingType: TMeetingType) => {
    if (!window.confirm(t("project_settings.meeting_types.delete_confirm"))) return;
    await calendarService.deleteMeetingType(workspaceSlug, projectId, meetingType.id);
    await mutate();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setOrdered(next);
    await calendarService.reorderMeetingTypes(
      workspaceSlug,
      projectId,
      next.map((item) => item.id)
    );
    await mutate();
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button
          variant="primary"
          prependIcon={<Plus className="size-4" />}
          onClick={() => {
            setForm(emptyForm);
            setIsEditing(true);
          }}
        >
          {t("project_settings.meeting_types.create")}
        </Button>
      </div>

      {isEditing && (
        <div className="border-accent-primary/30 shadow-sm rounded-xl border bg-surface-2 p-5">
          <div className="mb-4 text-14 font-semibold text-primary">
            {form.id ? t("project_settings.meeting_types.edit") : t("project_settings.meeting_types.create")}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-11 font-medium text-secondary">
              {t("project_settings.meeting_types.name")}
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className={`${fieldClass} mt-1.5`}
              />
            </label>
            <label className="text-11 font-medium text-secondary">
              {t("project_settings.meeting_types.color")}
              <div className="mt-1.5 flex gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                  className="h-9 w-12 rounded-md border border-subtle bg-surface-1 p-1"
                />
                <input
                  value={form.color}
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                  className={fieldClass}
                />
              </div>
            </label>
            <label className="text-11 font-medium text-secondary">
              {t("project_settings.meeting_types.duration")}
              <input
                type="number"
                min={5}
                max={1440}
                value={form.default_duration_minutes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, default_duration_minutes: Number(event.target.value) }))
                }
                className={`${fieldClass} mt-1.5`}
              />
            </label>
            <div className="text-11 font-medium text-secondary">
              {t("project_settings.meeting_types.mode")}
              <CalendarSelect
                value={form.default_attendance_mode}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    default_attendance_mode: value,
                  }))
                }
                className="mt-1.5"
                options={[
                  { value: "ONLINE", label: t("calendar.online"), icon: <Video className="size-3.5" /> },
                  { value: "MIXED", label: t("calendar.mixed"), icon: <Radio className="size-3.5" /> },
                  { value: "OFFLINE", label: t("calendar.offline"), icon: <MapPin className="size-3.5" /> },
                ]}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-12 text-secondary">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))}
              />
              {t("project_settings.meeting_types.default")}
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={isSaving} onClick={save}>
                {t("save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {ordered.map((meetingType, index) => (
          <div
            key={meetingType.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-subtle bg-surface-1 px-4 py-3"
          >
            <div
              className="grid size-10 place-items-center rounded-xl text-white"
              style={{ backgroundColor: meetingType.color }}
            >
              <CalendarClock className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-13 font-semibold text-primary">{meetingType.name}</span>
                {meetingType.is_default && (
                  <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-9 font-semibold text-accent-primary">
                    {t("project_settings.meeting_types.default")}
                  </span>
                )}
              </div>
              <div className="mt-1 text-10 text-secondary">
                {meetingType.default_duration_minutes} мин ·{" "}
                {t(`calendar.${meetingType.default_attendance_mode.toLowerCase()}`)}
              </div>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-md p-2 text-secondary hover:bg-layer-1"
                onClick={() => move(index, -1)}
                disabled={index === 0}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-2 text-secondary hover:bg-layer-1"
                onClick={() => move(index, 1)}
                disabled={index === ordered.length - 1}
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-2 text-secondary hover:bg-layer-1"
                onClick={() => {
                  setForm({
                    id: meetingType.id,
                    name: meetingType.name,
                    color: meetingType.color,
                    icon: meetingType.icon,
                    default_duration_minutes: meetingType.default_duration_minutes,
                    default_reminders: meetingType.default_reminders,
                    default_attendance_mode: meetingType.default_attendance_mode,
                    is_default: meetingType.is_default,
                  });
                  setIsEditing(true);
                }}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-2 text-danger-primary hover:bg-danger-subtle"
                onClick={() => remove(meetingType)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
