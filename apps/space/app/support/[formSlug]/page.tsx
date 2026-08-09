/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { IntakeService } from "@plane/services";
import type { TIntakeFormConditionRule, TIntakeFormField, TPublicIntakeForm } from "@plane/types";
import { cn } from "@plane/utils";
import type { Route } from "./+types/page";
import { formatBytes, getInitialSupportLocale, SUPPORT_COPY, type TSupportLocale } from "../intake-copy";

const service = new IntakeService();

const ruleMatches = (rule: TIntakeFormConditionRule, values: Record<string, unknown>) => {
  const actual = values[rule.field_id];
  const empty = actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && !actual.length);
  if (rule.operator === "IS_EMPTY") return empty;
  if (rule.operator === "IS_NOT_EMPTY") return !empty;
  if (rule.operator === "CONTAINS")
    return Array.isArray(actual)
      ? actual.includes(rule.value)
      : String(actual ?? "").includes(String(rule.value ?? ""));
  if (rule.operator === "NOT_EQUALS") return String(actual ?? "") !== String(rule.value ?? "");
  return String(actual ?? "") === String(rule.value ?? "");
};

const visibleFieldIds = (form: TPublicIntakeForm, values: Record<string, unknown>) => {
  const visible = new Set(form.fields.filter((field) => field.visible).map((field) => field.id));
  for (const condition of form.conditions) {
    const matches =
      condition.match === "ANY"
        ? condition.rules.some((rule) => ruleMatches(rule, values))
        : condition.rules.every((rule) => ruleMatches(rule, values));
    if (condition.action === "SHOW" ? matches : !matches) visible.add(condition.target_field_id);
    else visible.delete(condition.target_field_id);
  }
  return visible;
};

export default function PublicIntakeFormPage({ params }: Route.ComponentProps) {
  const { formSlug } = params;
  const navigate = useNavigate();
  const [locale, setLocale] = useState<TSupportLocale>("ru");
  const [form, setForm] = useState<TPublicIntakeForm | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessState, setAccessState] = useState<"loading" | "code" | "auth" | "missing" | "ready">("loading");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const copy = SUPPORT_COPY[locale];

  useEffect(() => setLocale(getInitialSupportLocale()), []);
  const loadForm = useCallback(
    async (code?: string) => {
      setAccessState("loading");
      try {
        const response = await service.getPublicForm(formSlug, code);
        setForm(response);
        setAccessState("ready");
      } catch (error: any) {
        const status = error?.response?.status;
        const reason = error?.response?.data?.error;
        if (status === 401 || reason === "AUTHENTICATION_REQUIRED") setAccessState("auth");
        else if (status === 403 && reason === "ACCESS_CODE_REQUIRED") setAccessState("code");
        else setAccessState("missing");
      }
    },
    [formSlug]
  );
  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const visibleIds = useMemo(() => (form ? visibleFieldIds(form, values) : new Set<string>()), [form, values]);
  const visibleFields = form?.fields.filter((field) => visibleIds.has(field.id)) ?? [];
  const attachmentsField = visibleFields.find((field) => field.key === "attachments");
  const fieldLabel = (field: TIntakeFormField) => {
    const translated = form?.translations?.[locale]?.[`field.${field.id}.label`];
    if (translated) return translated;
    if (field.source === "CUSTOM") return field.name || field.key;
    const key =
      field.key === "requester_name"
        ? "name"
        : field.key === "requester_email"
          ? "email"
          : field.key === "attachments"
            ? "files"
            : field.key;
    return String(copy[key as keyof typeof copy] || field.key);
  };

  const addFiles = (incoming: FileList | File[]) => {
    if (!form || !attachmentsField) return;
    setFiles((current) => {
      const combined = [...current, ...Array.from(incoming)];
      const unique = combined.filter(
        (file, index) =>
          combined.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.lastModified === file.lastModified &&
              candidate.type === file.type
          ) === index
      );
      return unique.slice(0, form.max_attachments);
    });
    setErrors((current) => ({ ...current, [attachmentsField.id]: "" }));
  };

  const uploadFiles = async (trackingToken: string) => {
    if (!form || !attachmentsField || !files.length) return [];
    const ids: string[] = [];
    for (const [index, file] of files.entries()) {
      setUploadLabel(`${index + 1}/${files.length}: ${file.name}`);
      // Upload sequentially so progress remains clear and project limits are checked per file.
      // eslint-disable-next-line no-await-in-loop
      const prepared = await service.preparePublicAsset(
        form.slug,
        {
          tracking_token: trackingToken,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          values,
        },
        accessCode || undefined
      );
      const body = new FormData();
      Object.entries(prepared.upload_data.fields).forEach(([key, value]) => body.append(key, value));
      body.append("file", file);
      // eslint-disable-next-line no-await-in-loop
      const uploaded = await fetch(prepared.upload_data.url, { method: "POST", body });
      if (!uploaded.ok) throw new Error("UPLOAD_FAILED");
      // eslint-disable-next-line no-await-in-loop
      await service.completePublicAsset(form.slug, prepared.asset_id, trackingToken, accessCode || undefined);
      ids.push(prepared.asset_id);
    }
    return ids;
  };

  const submit = async () => {
    if (!form) return;
    const nextErrors: Record<string, string> = {};
    visibleFields.forEach((field) => {
      const value = field.key === "attachments" ? files : values[field.id];
      if (field.required && (value === undefined || value === "" || (Array.isArray(value) && !value.length)))
        nextErrors[field.id] = copy.required;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setIsSubmitting(true);
    try {
      const token = form.tracking_token;
      const assetIds = await uploadFiles(token);
      const result = await service.createPublicSubmission(
        form.slug,
        { tracking_token: token, locale, values, asset_ids: assetIds },
        accessCode || undefined,
        token
      );
      localStorage.setItem(`gts-intake-${result.reference}`, token);
      navigate(result.tracking_path, { replace: true });
    } catch (error: any) {
      const serverErrors = error?.response?.data?.values;
      if (serverErrors && typeof serverErrors === "object") setErrors(serverErrors);
      else if (error?.response?.data?.asset_ids && attachmentsField) {
        setErrors({ [attachmentsField.id]: String(error.response.data.asset_ids) });
      } else {
        const diagnostic = import.meta.env.DEV
          ? ` (${error?.response?.data?.error || error?.message || "UNKNOWN_ERROR"})`
          : "";
        setErrors({ _form: `${copy.failed}${diagnostic}` });
      }
    } finally {
      setIsSubmitting(false);
      setUploadLabel("");
    }
  };

  if (accessState !== "ready" || !form) {
    return (
      <AccessScreen
        state={accessState}
        locale={locale}
        setLocale={setLocale}
        code={accessCode}
        setCode={setAccessCode}
        onOpen={() => void loadForm(accessCode)}
      />
    );
  }

  const accent = form.branding.accent_color || "#22A06B";
  return (
    <main
      className="min-h-screen bg-[#0d1211] text-white"
      style={{ "--support-accent": accent } as React.CSSProperties}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${accent}35, transparent 38%), linear-gradient(#ffffff05 1px, transparent 1px), linear-gradient(90deg, #ffffff05 1px, transparent 1px)`,
          backgroundSize: "auto, 32px 32px, 32px 32px",
        }}
      />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2 text-13 font-semibold">
          {form.branding.logo_url ? (
            <img src={form.branding.logo_url} alt="" className="size-8 rounded-lg object-contain" />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: accent }}>
              <Send className="size-4" />
            </div>
          )}
          GTS SYSTEM
        </div>
        <LocalePicker value={locale} onChange={setLocale} />
      </header>
      <div className="relative mx-auto grid max-w-5xl gap-8 px-5 pt-4 pb-16 lg:grid-cols-[1fr_560px] lg:pt-12">
        <section className="pt-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-11 text-white/70">
            <ShieldCheck className="size-3.5" />
            {form.project.name}
          </div>
          <h1 className="sm:text-42 mt-5 text-32 leading-tight font-semibold tracking-[-0.03em]">
            {form.translations?.[locale]?.name || form.name}
          </h1>
          <p className="text-15 mt-4 max-w-lg leading-6 text-white/60">
            {form.translations?.[locale]?.description || form.description}
          </p>
          <div className="mt-8 hidden items-center gap-3 text-12 text-white/45 lg:flex">
            <div className="flex size-8 items-center justify-center rounded-full border border-white/10">
              <Check className="size-4" />
            </div>
            {copy.receivedHelp}
          </div>
        </section>
        <section className="shadow-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#171d1b]/95 shadow-black/30 backdrop-blur-xl">
          {form.branding.header_image && (
            <img src={form.branding.header_image} alt="" className="h-36 w-full object-cover" />
          )}
          <div className="p-5 sm:p-7">
            <div className="space-y-5">
              {visibleFields.map((field) =>
                field.key === "attachments" ? (
                  <PublicAttachmentsField
                    key={field.id}
                    field={field}
                    label={fieldLabel(field)}
                    files={files}
                    maxFiles={form.max_attachments}
                    error={errors[field.id]}
                    fileInput={fileInput}
                    locale={locale}
                    onAdd={addFiles}
                    onRemove={(index) =>
                      setFiles((current) => current.filter((_item, itemIndex) => itemIndex !== index))
                    }
                  />
                ) : (
                  <PublicField
                    key={field.id}
                    field={field}
                    label={fieldLabel(field)}
                    value={values[field.id]}
                    error={errors[field.id]}
                    locale={locale}
                    onChange={(value) => {
                      setValues((current) => ({ ...current, [field.id]: value }));
                      setErrors((current) => ({ ...current, [field.id]: "" }));
                    }}
                  />
                )
              )}
            </div>
            {errors._form && (
              <div className="border-red-400/20 bg-red-400/10 text-red-200 mt-4 flex gap-2 rounded-lg border p-3 text-12">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {errors._form}
              </div>
            )}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void submit()}
              className="shadow-lg mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-13 font-semibold text-white disabled:opacity-60"
              style={{ background: accent }}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  {uploadLabel || copy.sending}
                </>
              ) : (
                <>
                  {copy.send}
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function PublicAttachmentsField({
  field,
  label,
  files,
  maxFiles,
  error,
  fileInput,
  locale,
  onAdd,
  onRemove,
}: {
  field: TIntakeFormField;
  label: string;
  files: File[];
  maxFiles: number;
  error?: string;
  fileInput: React.RefObject<HTMLInputElement | null>;
  locale: TSupportLocale;
  onAdd: (files: FileList | File[]) => void;
  onRemove: (index: number) => void;
}) {
  const help = SUPPORT_COPY[locale].filesHelp;
  return (
    <div>
      <label className="mb-2 block text-12 font-medium text-white/80">
        {label}
        {field.required && <span className="ml-1 text-[var(--support-accent)]">*</span>}{" "}
        <span className="font-normal text-white/40">
          ({files.length}/{maxFiles})
        </span>
      </label>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onAdd(event.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center rounded-xl border border-dashed bg-white/[0.025] px-4 py-6 text-center hover:border-white/30 hover:bg-white/[0.04]",
          error ? "border-red-400/60" : "border-white/15"
        )}
      >
        <Paperclip className="size-5 text-white/45" />
        <span className="mt-2 text-12 text-white/55">{help}</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => event.target.files && onAdd(event.target.files)}
      />
      {files.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${file.lastModified}-${file.type}`}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-11"
            >
              <FileText className="size-4 text-white/45" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-white/35">{formatBytes(file.size)}</span>
              <button type="button" onClick={() => onRemove(index)}>
                <X className="size-3.5 text-white/45" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <span className="text-red-300 mt-1.5 block text-11">{error}</span>}
    </div>
  );
}

function PublicField({
  field,
  label,
  value,
  error,
  locale,
  onChange,
}: {
  field: TIntakeFormField;
  label: string;
  value: unknown;
  error?: string;
  locale: TSupportLocale;
  onChange: (value: unknown) => void;
}) {
  const inputClass = cn(
    "min-h-10 w-full rounded-lg border bg-white/[0.035] px-3 text-13 text-white outline-none placeholder:text-white/25 focus:border-[var(--support-accent)]",
    error ? "border-red-400/60" : "border-white/10"
  );
  const key = field.key;
  let control: React.ReactNode;
  if (key === "description" || field.property_type === "LONG_TEXT")
    control = (
      <textarea
        className={cn(inputClass, "h-28 py-2.5")}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else if (key === "priority")
    control = (
      <select className={inputClass} value={String(value ?? "none")} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(SUPPORT_COPY[locale].priorities).map(([id, name]) => (
          <option key={id} value={id} className="bg-[#171d1b]">
            {name}
          </option>
        ))}
      </select>
    );
  else if (field.property_type === "SINGLE_SELECT")
    control = (
      <select className={inputClass} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="" className="bg-[#171d1b]">
          —
        </option>
        {field.options?.map((option) => (
          <option key={option.id} value={option.id} className="bg-[#171d1b]">
            {option.name}
          </option>
        ))}
      </select>
    );
  else if (field.property_type === "MULTI_SELECT")
    control = (
      <div className="flex flex-wrap gap-2">
        {field.options?.map((option) => {
          const selected = Array.isArray(value) && value.includes(option.id);
          return (
            <button
              type="button"
              key={option.id}
              onClick={() =>
                onChange(
                  selected
                    ? (value as string[]).filter((id) => id !== option.id)
                    : [...(Array.isArray(value) ? value : []), option.id]
                )
              }
              className={cn(
                "rounded-lg border px-3 py-2 text-12",
                selected ? "border-[var(--support-accent)] bg-white/10 text-white" : "border-white/10 text-white/55"
              )}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    );
  else if (field.property_type === "CHECKBOX")
    control = (
      <label className="flex items-center gap-2 text-13 text-white/70">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  else
    control = (
      <input
        className={inputClass}
        type={
          field.property_type === "NUMBER"
            ? "number"
            : field.property_type === "DATE"
              ? "date"
              : key === "requester_email"
                ? "email"
                : "text"
        }
        value={String(value ?? "")}
        onChange={(e) => onChange(field.property_type === "NUMBER" ? Number(e.target.value) : e.target.value)}
      />
    );
  return (
    <label className="block">
      {field.property_type !== "CHECKBOX" && (
        <span className="mb-2 block text-12 font-medium text-white/80">
          {label}
          {field.required && <span className="ml-1 text-[var(--support-accent)]">*</span>}
        </span>
      )}
      {control}
      {error && <span className="text-red-300 mt-1.5 block text-11">{error}</span>}
    </label>
  );
}

function AccessScreen({
  state,
  locale,
  setLocale,
  code,
  setCode,
  onOpen,
}: {
  state: "loading" | "code" | "auth" | "missing" | "ready";
  locale: TSupportLocale;
  setLocale: (locale: TSupportLocale) => void;
  code: string;
  setCode: (code: string) => void;
  onOpen: () => void;
}) {
  const copy = SUPPORT_COPY[locale];
  if (state === "loading")
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d1211] text-white">
        <LoaderCircle className="size-6 animate-spin text-white/50" />
      </main>
    );
  const isCode = state === "code";
  const isAuth = state === "auth";
  return (
    <main className="min-h-screen bg-[#0d1211] px-5 text-white">
      <header className="mx-auto flex max-w-4xl justify-end py-5">
        <LocalePicker value={locale} onChange={setLocale} />
      </header>
      <div className="shadow-2xl mx-auto mt-[12vh] max-w-md rounded-2xl border border-white/10 bg-[#171d1b] p-7">
        <div className="bg-emerald-400/10 text-emerald-300 flex size-11 items-center justify-center rounded-xl">
          {isCode ? (
            <LockKeyhole className="size-5" />
          ) : isAuth ? (
            <ShieldCheck className="size-5" />
          ) : (
            <AlertCircle className="size-5" />
          )}
        </div>
        <h1 className="text-22 mt-5 font-semibold">
          {isCode ? copy.codeTitle : isAuth ? copy.authTitle : copy.unavailableTitle}
        </h1>
        <p className="mt-2 text-13 leading-5 text-white/55">
          {isCode ? copy.codeHelp : isAuth ? copy.authHelp : copy.unavailableHelp}
        </p>
        {isCode && (
          <>
            <label className="mt-6 block text-12 text-white/70">{copy.code}</label>
            <input
              autoFocus
              type="password"
              className="focus:border-emerald-400/60 mt-2 h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-13 outline-none"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onOpen()}
            />
            <button
              type="button"
              onClick={onOpen}
              className="bg-emerald-600 mt-3 h-10 w-full rounded-lg text-13 font-semibold"
            >
              {copy.open}
            </button>
          </>
        )}
        {isAuth && (
          <a
            href={`/sign-in?next_path=${encodeURIComponent(window.location.pathname)}`}
            className="bg-emerald-600 mt-6 flex h-10 items-center justify-center rounded-lg text-13 font-semibold"
          >
            {copy.signIn}
          </a>
        )}
      </div>
    </main>
  );
}

function LocalePicker({ value, onChange }: { value: TSupportLocale; onChange: (value: TSupportLocale) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
      {(["ru", "uz", "en"] as const).map((locale) => (
        <button
          type="button"
          key={locale}
          onClick={() => onChange(locale)}
          className={cn(
            "rounded-md px-2.5 py-1 text-11 uppercase",
            value === locale ? "bg-white/10 text-white" : "text-white/45"
          )}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
