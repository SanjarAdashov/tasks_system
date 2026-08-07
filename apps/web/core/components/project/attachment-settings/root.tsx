/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Archive, FileQuestion, FileText, Files, Image, Music, Video, type LucideIcon } from "lucide-react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectAttachmentSettings } from "@plane/types";
import { Button, CustomSelect, Input, Loader } from "@plane/ui";
import { ProjectService } from "@/services/project";

const MEBIBYTE = 1024 * 1024;
const LOADER_KEYS = ["file-limit-1", "file-limit-2", "file-limit-3", "file-limit-4", "file-limit-5"];

type TLimitField =
  | "image_max_size"
  | "video_max_size"
  | "audio_max_size"
  | "pdf_max_size"
  | "document_max_size"
  | "archive_max_size"
  | "other_max_size";
type TLimitMode = "LIMITED" | "UNLIMITED" | "DISABLED";
type TLimitDraft = Record<TLimitField, { mode: TLimitMode; size: string }>;
type TAttachmentSettingsPayload = Pick<TProjectAttachmentSettings, TLimitField>;

const LIMIT_FIELDS: {
  key: TLimitField;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    key: "image_max_size",
    label: "project_settings.attachments.categories.images",
    description: "project_settings.attachments.categories.images_help",
    icon: Image,
  },
  {
    key: "video_max_size",
    label: "project_settings.attachments.categories.video",
    description: "project_settings.attachments.categories.video_help",
    icon: Video,
  },
  {
    key: "audio_max_size",
    label: "project_settings.attachments.categories.audio",
    description: "project_settings.attachments.categories.audio_help",
    icon: Music,
  },
  {
    key: "pdf_max_size",
    label: "project_settings.attachments.categories.pdf",
    description: "project_settings.attachments.categories.pdf_help",
    icon: FileText,
  },
  {
    key: "document_max_size",
    label: "project_settings.attachments.categories.documents",
    description: "project_settings.attachments.categories.documents_help",
    icon: Files,
  },
  {
    key: "archive_max_size",
    label: "project_settings.attachments.categories.archives",
    description: "project_settings.attachments.categories.archives_help",
    icon: Archive,
  },
  {
    key: "other_max_size",
    label: "project_settings.attachments.categories.other",
    description: "project_settings.attachments.categories.other_help",
    icon: FileQuestion,
  },
];

const toDraft = (settings: TProjectAttachmentSettings): TLimitDraft =>
  Object.fromEntries(
    LIMIT_FIELDS.map(({ key }) => {
      const value = settings[key];
      return [
        key,
        {
          mode: value === null ? "UNLIMITED" : value === 0 ? "DISABLED" : "LIMITED",
          size: value && value > 0 ? String(Number((value / MEBIBYTE).toFixed(2))) : "",
        },
      ];
    })
  ) as TLimitDraft;

const toPayload = (draft: TLimitDraft): TAttachmentSettingsPayload | undefined => {
  const payload = {} as TAttachmentSettingsPayload;

  for (const { key } of LIMIT_FIELDS) {
    const value = draft[key];
    if (value.mode === "UNLIMITED") {
      payload[key] = null;
      continue;
    }
    if (value.mode === "DISABLED") {
      payload[key] = 0;
      continue;
    }

    const sizeInMiB = Number(value.size);
    const sizeInBytes = Math.round(sizeInMiB * MEBIBYTE);
    if (!Number.isFinite(sizeInMiB) || sizeInMiB <= 0 || !Number.isSafeInteger(sizeInBytes)) return undefined;
    payload[key] = sizeInBytes;
  }

  return payload;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!error || typeof error !== "object") return fallback;
  const firstValue = Object.values(error)[0];
  if (typeof firstValue === "string") return firstValue;
  if (Array.isArray(firstValue) && typeof firstValue[0] === "string") return firstValue[0];
  return fallback;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export function AttachmentSettings({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const swrKey = `PROJECT_ATTACHMENT_SETTINGS_${workspaceSlug}_${projectId}`;
  const {
    data: settings,
    isLoading,
    mutate,
  } = useSWR(swrKey, () => service.getAttachmentSettings(workspaceSlug, projectId));
  const [draft, setDraft] = useState<TLimitDraft | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const payload = draft ? toPayload(draft) : undefined;
  const isDirty =
    !!settings &&
    !!draft &&
    LIMIT_FIELDS.some(({ key }) => {
      if (!payload) return true;
      return payload[key] !== settings[key];
    });

  const updateField = (field: TLimitField, changes: Partial<TLimitDraft[TLimitField]>) => {
    setDraft((current) => {
      if (!current) return current;
      const nextValue = { ...current[field], ...changes };
      if (nextValue.mode === "LIMITED" && !nextValue.size) nextValue.size = "1";
      return { ...current, [field]: nextValue };
    });
  };

  const saveSettings = async () => {
    if (!payload) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.attachments.toast.invalid_title"),
        message: t("project_settings.attachments.toast.invalid_message"),
      });
      return;
    }

    setIsSaving(true);
    try {
      const saved = await service.updateAttachmentSettings(workspaceSlug, projectId, payload);
      await mutate(saved, { revalidate: false });
      setDraft(toDraft(saved));
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_settings.attachments.toast.success_title"),
        message: t("project_settings.attachments.toast.success_message"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.attachments.toast.error_title"),
        message: getErrorMessage(error, t("project_settings.attachments.toast.error_message")),
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !draft || !settings) {
    return (
      <Loader className="flex flex-col gap-2">
        {LOADER_KEYS.map((key) => (
          <Loader.Item key={key} height="76px" width="100%" />
        ))}
      </Loader>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-12">
      <div className="rounded-lg border border-subtle bg-surface-1 px-4 py-3 text-12 text-secondary">
        {t("project_settings.attachments.help")}
      </div>

      <div className="overflow-hidden rounded-lg border border-subtle">
        {LIMIT_FIELDS.map(({ key, label, description, icon: Icon }) => {
          const value = draft[key];
          return (
            <div
              key={key}
              className="grid grid-cols-1 gap-3 border-b border-subtle px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_12rem_12rem] md:items-center"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-secondary">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-13 font-medium text-primary">{t(label)}</div>
                  <div className="mt-0.5 text-11 text-tertiary">{t(description)}</div>
                </div>
              </div>

              <CustomSelect
                value={value.mode}
                onChange={(mode: TLimitMode) => updateField(key, { mode })}
                label={t(`project_settings.attachments.modes.${value.mode.toLowerCase()}`)}
                buttonClassName="w-full !border-subtle !shadow-none"
                input
              >
                {(["LIMITED", "UNLIMITED", "DISABLED"] as const).map((mode) => (
                  <CustomSelect.Option key={mode} value={mode}>
                    {t(`project_settings.attachments.modes.${mode.toLowerCase()}`)}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>

              {value.mode === "LIMITED" ? (
                <div className="relative">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={value.size}
                    onChange={(event) => updateField(key, { size: event.target.value })}
                    className="pr-12"
                    aria-label={t("project_settings.attachments.limit_in_mib")}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-11 text-tertiary">
                    MiB
                  </span>
                </div>
              ) : (
                <div className="text-12 text-tertiary md:px-3">
                  {t(`project_settings.attachments.mode_help.${value.mode.toLowerCase()}`)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="neutral-primary" disabled={!isDirty || isSaving} onClick={() => setDraft(toDraft(settings))}>
          {t("project_settings.attachments.reset")}
        </Button>
        <Button loading={isSaving} disabled={!isDirty || !payload} onClick={saveSettings}>
          {t("project_settings.attachments.save")}
        </Button>
      </div>
    </div>
  );
}
