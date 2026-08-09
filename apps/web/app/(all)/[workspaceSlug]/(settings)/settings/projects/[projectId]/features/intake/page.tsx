/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import {
  Archive,
  ArrowUpRight,
  Check,
  ClipboardList,
  Copy,
  FileText,
  Globe2,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { IntakeService } from "@plane/services";
import type {
  IState,
  TIntakeForm,
  TIntakeFormAccessType,
  TIntakeFormCondition,
  TIntakeFormConditionRule,
  TIntakeFormField,
  TIntakeFormPayload,
  TProjectUserGroup,
  TProjectWorkItemProperty,
} from "@plane/types";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectSettingsFeatureControlItem } from "@/components/settings/project/content/feature-control-item";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { ProjectService } from "@/services/project";
import { ProjectStateService } from "@/services/project/project-state.service";
import type { Route } from "./+types/page";
import { FeaturesIntakeProjectSettingsHeader } from "./header";

const intakeService = new IntakeService();
const projectService = new ProjectService();
const stateService = new ProjectStateService();

type TFormsTab = "active" | "archived";
type TEditorState = { mode: "create"; form: null } | { mode: "edit"; form: TIntakeForm };
type TEditorStep = "basics" | "access" | "fields" | "routing" | "appearance";
type TConfirmState = { action: "archive" | "restore" | "delete"; form: TIntakeForm };

const DEFAULT_FIELDS: TIntakeFormField[] = [
  { id: "requester_name", source: "FORM", key: "requester_name", visible: true, required: false, sort_order: 1000 },
  { id: "requester_email", source: "FORM", key: "requester_email", visible: true, required: false, sort_order: 2000 },
  { id: "title", source: "SYSTEM", key: "title", visible: true, required: true, sort_order: 3000 },
  { id: "description", source: "SYSTEM", key: "description", visible: true, required: false, sort_order: 4000 },
  { id: "priority", source: "SYSTEM", key: "priority", visible: false, required: false, sort_order: 5000 },
];

const fieldLabelKey = (field: TIntakeFormField) =>
  field.source === "CUSTOM" ? field.name || field.key : `project_settings.features.intake.builder.fields.${field.key}`;

function FeaturesIntakeSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const { currentProjectDetails } = useProject();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const [activeTab, setActiveTab] = useState<TFormsTab>("active");
  const [editor, setEditor] = useState<TEditorState | null>(null);
  const [confirm, setConfirm] = useState<TConfirmState | null>(null);
  const { data: forms, mutate } = useSWR(
    canManage ? ["PROJECT_INTAKE_FORMS", workspaceSlug, projectId] : null,
    () => intakeService.getForms(workspaceSlug, projectId)
  );

  const activeForms = useMemo(() => forms?.filter((form) => !form.archived_at) ?? [], [forms]);
  const archivedForms = useMemo(() => forms?.filter((form) => Boolean(form.archived_at)) ?? [], [forms]);
  const displayedForms = activeTab === "active" ? activeForms : archivedForms;
  const submissionCount = forms?.reduce((total, form) => total + form.submission_count, 0) ?? 0;
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} settings - ${t("project_settings.features.intake.short_title")}`
    : undefined;

  if (workspaceUserInfo && !canManage) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<FeaturesIntakeProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <section className="w-full">
        <SettingsHeading
          title={t("project_settings.features.intake.title")}
          description={t("project_settings.features.intake.description")}
        />
        <div className="space-y-6 p-6">
          <ProjectSettingsFeatureControlItem
            title={t("project_settings.features.intake.toggle_title")}
            description={t("project_settings.features.intake.toggle_description")}
            featureProperty="inbox_view"
            projectId={projectId}
            value={!!currentProjectDetails?.inbox_view}
            workspaceSlug={workspaceSlug}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              icon={<FileText className="size-4" />}
              label={t("project_settings.features.intake.builder.metrics.active")}
              value={activeForms.length}
            />
            <MetricCard
              icon={<ClipboardList className="size-4" />}
              label={t("project_settings.features.intake.builder.metrics.submissions")}
              value={submissionCount}
            />
            <MetricCard
              icon={<Globe2 className="size-4" />}
              label={t("project_settings.features.intake.builder.metrics.public")}
              value={activeForms.filter((form) => form.access_type === "PUBLIC").length}
            />
          </div>

          <div className="flex flex-col gap-3 border-b border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex w-fit rounded-lg border border-subtle bg-layer-1 p-1" role="tablist">
              {(["active", "archived"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-13 font-medium transition-colors",
                    activeTab === tab ? "bg-layer-2 text-primary shadow-raised-100" : "text-secondary hover:text-primary"
                  )}
                >
                  {t(`project_settings.features.intake.builder.tabs.${tab}`)}
                  <span className="rounded-full bg-layer-3 px-2 py-0.5 text-11 text-secondary">
                    {tab === "active" ? activeForms.length : archivedForms.length}
                  </span>
                </button>
              ))}
            </div>
            <Button size="xl" onClick={() => setEditor({ mode: "create", form: null })}>
              <Plus className="size-4" />
              {t("project_settings.features.intake.form.create_form")}
            </Button>
          </div>

          {!forms ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl bg-layer-2" />)}
            </div>
          ) : displayedForms.length ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {displayedForms.map((form) => (
                <FormCard
                  key={form.id}
                  form={form}
                  onEdit={() => setEditor({ mode: "edit", form })}
                  onAction={(action) => setConfirm({ action, form })}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-subtle bg-layer-1 px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-accent-primary">
                {activeTab === "active" ? <Sparkles className="size-6" /> : <Archive className="size-6" />}
              </div>
              <h3 className="mt-4 text-16 font-semibold text-primary">
                {t(`project_settings.features.intake.builder.empty.${activeTab}.title`)}
              </h3>
              <p className="mt-1 max-w-md text-13 text-secondary">
                {t(`project_settings.features.intake.builder.empty.${activeTab}.description`)}
              </p>
              {activeTab === "active" && (
                <Button className="mt-4" onClick={() => setEditor({ mode: "create", form: null })}>
                  <Plus className="size-4" />
                  {t("project_settings.features.intake.form.create_form")}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <IntakeFormEditor
        state={editor}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          await mutate();
        }}
      />
      <FormActionModal
        state={confirm}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        onClose={() => setConfirm(null)}
        onCompleted={async () => {
          setConfirm(null);
          await mutate();
        }}
      />
    </SettingsContentWrapper>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-subtle bg-layer-1 p-4">
      <div className="flex items-center gap-2 text-12 text-secondary">{icon}{label}</div>
      <div className="mt-2 text-24 font-semibold text-primary">{value}</div>
    </div>
  );
}

function FormCard({
  form,
  onEdit,
  onAction,
}: {
  form: TIntakeForm;
  onEdit: () => void;
  onAction: (action: "archive" | "restore" | "delete") => void;
}) {
  const { t } = useTranslation();
  const isArchived = Boolean(form.archived_at);
  const copyUrl = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${form.public_path}`);
    setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_settings.features.intake.builder.copied"), message: form.public_path });
  };
  const AccessIcon = form.access_type === "PUBLIC" ? Globe2 : form.access_type === "CODE" ? KeyRound : LockKeyhole;

  return (
    <article className="overflow-hidden rounded-xl border border-subtle bg-layer-1">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-primary">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-15 font-semibold text-primary">{form.name}</h3>
              {!form.is_enabled && !isArchived && <span className="rounded-full bg-layer-3 px-2 py-0.5 text-10 text-secondary">{t("project_settings.features.intake.builder.disabled")}</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-12 text-secondary">{form.description || t("project_settings.features.intake.builder.no_description")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isArchived ? (
            <>
              <Button variant="secondary" size="lg" onClick={() => onAction("restore")}><RotateCcw className="size-4" /></Button>
              {!form.submission_count && <Button variant="error-outline" size="lg" onClick={() => onAction("delete")}><Trash2 className="size-4" /></Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" onClick={onEdit}><Pencil className="size-4" />{t("project_settings.features.intake.builder.edit")}</Button>
              <Button variant="secondary" size="lg" onClick={() => onAction("archive")}><Archive className="size-4" /></Button>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 border-y border-subtle bg-layer-2/40 text-12 sm:grid-cols-3">
        <div className="border-r border-subtle p-3"><span className="text-tertiary">{t("project_settings.features.intake.builder.access")}</span><div className="mt-1 flex items-center gap-1.5 font-medium text-primary"><AccessIcon className="size-3.5" />{t(`project_settings.features.intake.builder.access_types.${form.access_type}`)}</div></div>
        <div className="border-r border-subtle p-3"><span className="text-tertiary">{t("project_settings.features.intake.builder.requests")}</span><div className="mt-1 font-medium text-primary">{form.submission_count}</div></div>
        <div className="hidden p-3 sm:block"><span className="text-tertiary">{t("project_settings.features.intake.builder.fields_count")}</span><div className="mt-1 font-medium text-primary">{form.field_schema.filter((field) => field.visible).length}</div></div>
      </div>
      <div className="flex items-center gap-2 p-3">
        <code className="min-w-0 flex-1 truncate rounded-md bg-layer-2 px-3 py-2 text-11 text-secondary">{form.public_path}</code>
        <Button variant="secondary" size="lg" onClick={() => void copyUrl()}><Copy className="size-4" /></Button>
        {!isArchived && form.is_enabled && <a href={form.public_path} target="_blank" rel="noreferrer"><Button variant="secondary" size="lg"><ArrowUpRight className="size-4" /></Button></a>}
      </div>
    </article>
  );
}

function createDraft(form: TIntakeForm | null, states: IState[], groups: TProjectUserGroup[]): TIntakeFormPayload {
  if (form) {
    const { id: _id, archived_at: _archived, has_access_code: _hasCode, public_path: _path, submission_count: _count, created_at: _created, updated_at: _updated, ...payload } = form;
    return payload;
  }
  return {
    name: "",
    slug: "support",
    description: "",
    is_enabled: true,
    access_type: "PUBLIC",
    target_state: states.find((state) => state.default)?.id || states[0]?.id || "",
    reviewer_group: groups[0]?.id || "",
    field_schema: DEFAULT_FIELDS.map((field) => ({ ...field })),
    hidden_values: {},
    conditions: [],
    branding: { accent_color: "#22A06B", success_message: "" },
    translations: {},
    public_status_mapping: {
      PENDING: "RECEIVED",
      SNOOZED: "UNDER_REVIEW",
      ACCEPTED: "IN_PROGRESS",
      REJECTED: "REJECTED",
      DUPLICATE: "COMPLETED",
      state_ids: {},
    },
    title_template: "",
    email_notifications_enabled: false,
    max_attachments: 20,
  };
}

function IntakeFormEditor({
  state,
  workspaceSlug,
  projectId,
  onClose,
  onSaved,
}: {
  state: TEditorState | null;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<TEditorStep>("basics");
  const [draft, setDraft] = useState<TIntakeFormPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const { data: states = [] } = useSWR(state ? ["INTAKE_FORM_STATES", workspaceSlug, projectId] : null, () => stateService.getStates(workspaceSlug, projectId));
  const { data: groups = [] } = useSWR(state ? ["INTAKE_FORM_GROUPS", workspaceSlug, projectId] : null, () => projectService.getUserGroups(workspaceSlug, projectId));
  const { data: properties = [] } = useSWR(state ? ["INTAKE_FORM_PROPERTIES", workspaceSlug, projectId] : null, () => projectService.getWorkItemProperties(workspaceSlug, projectId));

  useEffect(() => {
    if (!state || !states.length) return;
    setDraft(createDraft(state.form, states, groups));
    setStep("basics");
    setServerError("");
  }, [state, states, groups]);

  const update = <K extends keyof TIntakeFormPayload>(key: K, value: TIntakeFormPayload[K]) =>
    setDraft((current) => current ? { ...current, [key]: value } : current);
  const steps: { id: TEditorStep; icon: React.ReactNode }[] = [
    { id: "basics", icon: <FileText className="size-4" /> },
    { id: "access", icon: <LockKeyhole className="size-4" /> },
    { id: "fields", icon: <ClipboardList className="size-4" /> },
    { id: "routing", icon: <Settings2 className="size-4" /> },
    { id: "appearance", icon: <Sparkles className="size-4" /> },
  ];
  const canSave = Boolean(draft?.name.trim() && draft.slug.trim() && draft.target_state && draft.reviewer_group);

  const handleSave = async () => {
    if (!draft || !state || !canSave) return;
    setIsSubmitting(true);
    setServerError("");
    try {
      if (state.form) await intakeService.updateForm(workspaceSlug, projectId, state.form.id, draft);
      else await intakeService.createForm(workspaceSlug, projectId, draft);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t(state.form ? "project_settings.features.intake.form.toasts.success_update" : "project_settings.features.intake.form.toasts.success_create"),
        message: t("project_settings.features.intake.builder.saved_message"),
      });
      await onSaved();
    } catch (error: any) {
      const data = error?.response?.data || error?.data || error;
      const message = data?.slug?.message || data?.slug?.[0] || data?.title_template?.[0] || t("project_settings.features.intake.builder.save_error");
      const suggestions = Array.isArray(data?.slug?.suggestions) ? data.slug.suggestions.join(", ") : "";
      setServerError(`${String(message)}${suggestions ? ` ${t("project_settings.features.intake.builder.slug_suggestions")}: ${suggestions}` : ""}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={Boolean(state)} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.VIXL}>
      <div className="flex h-[min(860px,92vh)] w-full flex-col overflow-hidden">
        <div className="flex items-start justify-between border-b border-subtle px-5 py-4">
          <div><h2 className="text-18 font-semibold text-primary">{t(state?.form ? "project_settings.features.intake.form.edit_form" : "project_settings.features.intake.form.create_form")}</h2><p className="mt-1 text-12 text-secondary">{t("project_settings.features.intake.builder.editor_help")}</p></div>
          {draft && <span className="rounded-full bg-layer-2 px-2.5 py-1 text-11 text-secondary">/support/{draft.slug || "..."}</span>}
        </div>
        {!draft ? <div className="flex flex-1 items-center justify-center text-13 text-secondary">{t("project_settings.features.intake.builder.loading")}</div> : (
          <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)_330px]">
            <nav className="border-r border-subtle bg-layer-1 p-3">
              {steps.map((item, index) => <button key={item.id} type="button" onClick={() => setStep(item.id)} className={cn("mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-12 font-medium", step === item.id ? "bg-accent-subtle text-accent-primary" : "text-secondary hover:bg-layer-2 hover:text-primary")}><span className="flex size-6 items-center justify-center rounded-md bg-layer-2 text-11">{step === item.id ? <Check className="size-3.5" /> : index + 1}</span>{item.icon}{t(`project_settings.features.intake.builder.steps.${item.id}`)}</button>)}
            </nav>
            <div className="vertical-scrollbar min-w-0 overflow-y-auto p-5">
              {step === "basics" && <BasicsStep draft={draft} update={update} />}
              {step === "access" && <AccessStep draft={draft} update={update} workspaceSlug={workspaceSlug} projectId={projectId} />}
              {step === "fields" && <FieldsStep draft={draft} update={update} properties={properties} />}
              {step === "routing" && <RoutingStep draft={draft} update={update} states={states} groups={groups} />}
              {step === "appearance" && <AppearanceStep draft={draft} update={update} />}
            </div>
            <div className="hidden border-l border-subtle bg-layer-1 p-4 lg:block"><p className="mb-3 text-11 font-semibold uppercase tracking-wide text-tertiary">{t("project_settings.features.intake.builder.preview")}</p><FormPreview draft={draft} /></div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-subtle px-5 py-3">
          <p className="text-12 text-danger-primary">{serverError}</p>
          <div className="ml-auto flex gap-2"><Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>{t("cancel")}</Button><Button size="lg" onClick={() => void handleSave()} disabled={!canSave} loading={isSubmitting}>{t("project_settings.features.intake.builder.save")}</Button></div>
        </div>
      </div>
    </ModalCore>
  );
}

type TStepProps = { draft: TIntakeFormPayload; update: <K extends keyof TIntakeFormPayload>(key: K, value: TIntakeFormPayload[K]) => void };
const controlClass = "h-9 w-full rounded-md border border-subtle bg-surface-2 px-3 text-13 text-primary outline-none focus:border-accent-primary";

function SectionIntro({ title, description }: { title: string; description: string }) { return <div className="mb-5"><h3 className="text-16 font-semibold text-primary">{title}</h3><p className="mt-1 text-12 text-secondary">{description}</p></div>; }
function FieldLabel({ children }: { children: React.ReactNode }) { return <span className="mb-1.5 block text-12 font-medium text-primary">{children}</span>; }

function BasicsStep({ draft, update }: TStepProps) {
  const { t } = useTranslation();
  return <div><SectionIntro title={t("project_settings.features.intake.builder.steps.basics")} description={t("project_settings.features.intake.builder.help.basics")} /><div className="space-y-4"><label><FieldLabel>{t("project_settings.features.intake.builder.name")}</FieldLabel><Input className="w-full" value={draft.name} onChange={(e) => update("name", e.target.value)} /></label><label><FieldLabel>{t("project_settings.features.intake.builder.description_label")}</FieldLabel><textarea className={cn(controlClass, "h-24 py-2")} value={draft.description} onChange={(e) => update("description", e.target.value)} /></label><label><FieldLabel>{t("project_settings.features.intake.builder.public_url")}</FieldLabel><div className="flex items-center rounded-md border border-subtle bg-surface-2"><span className="border-r border-subtle px-3 text-12 text-tertiary">/support/</span><input className="h-9 min-w-0 flex-1 bg-transparent px-3 text-13 text-primary outline-none" value={draft.slug} onChange={(e) => update("slug", e.target.value)} /></div></label><CheckRow checked={draft.is_enabled} onChange={(checked) => update("is_enabled", checked)} title={t("project_settings.features.intake.builder.enabled")} description={t("project_settings.features.intake.builder.enabled_help")} /></div></div>;
}

function AccessStep({ draft, update, workspaceSlug, projectId }: TStepProps & { workspaceSlug: string; projectId: string }) {
  const { t } = useTranslation();
  const choices: { value: TIntakeFormAccessType; icon: React.ReactNode }[] = [{ value: "PUBLIC", icon: <Globe2 className="size-5" /> }, { value: "CODE", icon: <KeyRound className="size-5" /> }, { value: "AUTHENTICATED", icon: <LockKeyhole className="size-5" /> }];
  return <div><SectionIntro title={t("project_settings.features.intake.builder.steps.access")} description={t("project_settings.features.intake.builder.help.access")} /><div className="space-y-3">{choices.map((choice) => <button key={choice.value} type="button" onClick={() => update("access_type", choice.value)} className={cn("flex w-full items-start gap-3 rounded-xl border p-4 text-left", draft.access_type === choice.value ? "border-accent-primary bg-accent-subtle" : "border-subtle hover:bg-layer-2")}><div className="text-accent-primary">{choice.icon}</div><div><div className="text-13 font-semibold text-primary">{t(`project_settings.features.intake.builder.access_types.${choice.value}`)}</div><p className="mt-1 text-12 text-secondary">{t(`project_settings.features.intake.builder.access_help.${choice.value}`)}</p></div></button>)}{draft.access_type === "CODE" && <div className="rounded-xl border border-subtle p-4"><FieldLabel>{t("project_settings.features.intake.builder.access_code")}</FieldLabel><div className="flex gap-2"><Input className="flex-1" value={draft.access_code || ""} onChange={(e) => update("access_code", e.target.value)} /><Button variant="secondary" onClick={async () => update("access_code", await intakeService.generateAccessCode(workspaceSlug, projectId))}>{t("project_settings.features.intake.builder.generate")}</Button></div></div>}</div></div>;
}

function FieldsStep({ draft, update, properties }: TStepProps & { properties: TProjectWorkItemProperty[] }) {
  const { t } = useTranslation();
  const publicProperties = properties.filter((property) => property.select_source !== "MEMBERS" && !property.archived_at);
  const setFields = (fields: TIntakeFormField[]) => update("field_schema", fields.map((field, index) => ({ ...field, sort_order: (index + 1) * 1000 })));
  const toggleProperty = (property: TProjectWorkItemProperty) => {
    const existing = draft.field_schema.find((field) => field.property_id === property.id);
    if (existing) setFields(draft.field_schema.filter((field) => field !== existing));
    else setFields([...draft.field_schema, { id: `property_${property.id}`, source: "CUSTOM", key: property.name, property_id: property.id, name: property.name, visible: true, required: false, sort_order: 0 }]);
  };
  return <div><SectionIntro title={t("project_settings.features.intake.builder.steps.fields")} description={t("project_settings.features.intake.builder.help.fields")} /><div className="space-y-2">{draft.field_schema.map((field, index) => <div key={field.id} className="rounded-lg border border-subtle p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-13 font-medium text-primary">{field.source === "CUSTOM" ? field.name : t(fieldLabelKey(field))}</p><p className="mt-0.5 text-11 text-tertiary">{field.source === "CUSTOM" ? t("project_settings.features.intake.builder.custom_field") : t("project_settings.features.intake.builder.system_field")}</p></div><div className="flex gap-4"><MiniCheck label={t("project_settings.features.intake.builder.visible")} checked={field.visible} onChange={(checked) => setFields(draft.field_schema.map((item, fieldIndex) => fieldIndex === index ? { ...item, visible: checked, required: checked ? item.required : false } : item))} /><MiniCheck label={t("project_settings.features.intake.builder.required")} checked={field.required} disabled={!field.visible} onChange={(checked) => setFields(draft.field_schema.map((item, fieldIndex) => fieldIndex === index ? { ...item, required: checked } : item))} /></div></div>{!field.visible && field.key !== "title" && <HiddenDefaultEditor field={field} property={properties.find((item) => item.id === field.property_id)} draft={draft} update={update} />}</div>)}</div>{!draft.field_schema.find((field) => field.key === "title")?.visible && <label className="mt-4 block"><FieldLabel>{t("project_settings.features.intake.builder.title_template")}</FieldLabel><Input className="w-full" value={draft.title_template} onChange={(e) => update("title_template", e.target.value)} placeholder="Support: {requester_name}" /></label>}<div className="mt-6"><h4 className="text-13 font-semibold text-primary">{t("project_settings.features.intake.builder.custom_fields")}</h4><p className="mt-1 text-11 text-secondary">{t("project_settings.features.intake.builder.custom_fields_help")}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{publicProperties.map((property) => <button type="button" key={property.id} onClick={() => toggleProperty(property)} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left text-12", draft.field_schema.some((field) => field.property_id === property.id) ? "border-accent-primary bg-accent-subtle text-primary" : "border-subtle text-secondary hover:bg-layer-2")}><span className="truncate">{property.name}</span>{draft.field_schema.some((field) => field.property_id === property.id) && <Check className="size-4 text-accent-primary" />}</button>)}</div></div><ConditionBuilder draft={draft} update={update} /></div>;
}

function HiddenDefaultEditor({ field, property, draft, update }: TStepProps & { field: TIntakeFormField; property?: TProjectWorkItemProperty }) {
  const { t } = useTranslation();
  const propertyValues = (draft.hidden_values.property_values || {}) as Record<string, unknown>;
  const value = property && field.property_id ? propertyValues[field.property_id] : draft.hidden_values[field.key];
  const onChange = (nextValue: unknown) => {
    if (property && field.property_id) {
      update("hidden_values", { ...draft.hidden_values, property_values: { ...propertyValues, [field.property_id]: nextValue } });
    } else update("hidden_values", { ...draft.hidden_values, [field.key]: nextValue });
  };
  const label = <span className="mb-1.5 block text-11 font-medium text-secondary">{t("project_settings.features.intake.builder.hidden_default")}</span>;
  if (field.key === "priority") return <label className="mt-3 block border-t border-subtle pt-3">{label}<select className={controlClass} value={String(value || "none")} onChange={(event) => onChange(event.target.value)}>{(["none", "low", "medium", "high", "urgent"] as const).map((priority) => <option key={priority} value={priority}>{t(`project_settings.features.intake.builder.priorities.${priority}`)}</option>)}</select></label>;
  if (property?.property_type === "CHECKBOX") return <div className="mt-3 border-t border-subtle pt-3"><MiniCheck label={t("project_settings.features.intake.builder.hidden_checkbox_default")} checked={Boolean(value)} onChange={onChange} /></div>;
  if (property?.property_type === "SINGLE_SELECT") return <label className="mt-3 block border-t border-subtle pt-3">{label}<select className={controlClass} value={String(value || "")} onChange={(event) => onChange(event.target.value || null)}><option value="">—</option>{property.options.filter((option) => !option.archived_at).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
  if (property?.property_type === "MULTI_SELECT") return <div className="mt-3 border-t border-subtle pt-3">{label}<div className="flex flex-wrap gap-2">{property.options.filter((option) => !option.archived_at).map((option) => { const selected = Array.isArray(value) && value.includes(option.id); return <button type="button" key={option.id} onClick={() => onChange(selected ? value.filter((id) => id !== option.id) : [...(Array.isArray(value) ? value : []), option.id])} className={cn("rounded-md border px-2.5 py-1.5 text-11", selected ? "border-accent-primary bg-accent-subtle text-primary" : "border-subtle text-secondary")}>{option.name}</button>; })}</div></div>;
  return <label className="mt-3 block border-t border-subtle pt-3">{label}<Input className="w-full" type={property?.property_type === "NUMBER" ? "number" : property?.property_type === "DATE" ? "date" : field.key === "requester_email" ? "email" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => onChange(property?.property_type === "NUMBER" ? Number(event.target.value) : event.target.value)} /></label>;
}

function ConditionBuilder({ draft, update }: TStepProps) {
  const { t } = useTranslation();
  const firstFieldId = draft.field_schema[0]?.id || "";
  const secondFieldId = draft.field_schema[1]?.id || firstFieldId;
  const add = () => update("conditions", [...draft.conditions, { target_field_id: firstFieldId, action: "SHOW", match: "ALL", rules: [{ field_id: secondFieldId, operator: "EQUALS", value: "" }] }]);
  const change = (index: number, condition: TIntakeFormCondition) => update("conditions", draft.conditions.map((item, itemIndex) => itemIndex === index ? condition : item));
  const fieldName = (field: TIntakeFormField) => field.source === "CUSTOM" ? field.name : t(fieldLabelKey(field));
  const operators: TIntakeFormConditionRule["operator"][] = ["EQUALS", "NOT_EQUALS", "CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY"];
  return (
    <div className="mt-6 border-t border-subtle pt-5">
      <div className="flex items-center justify-between gap-4">
        <div><h4 className="text-13 font-semibold text-primary">{t("project_settings.features.intake.builder.conditions")}</h4><p className="mt-1 text-11 text-secondary">{t("project_settings.features.intake.builder.conditions_help")}</p></div>
        <Button variant="secondary" size="lg" onClick={add}><Plus className="size-4" />{t("project_settings.features.intake.builder.add_condition")}</Button>
      </div>
      <div className="mt-3 space-y-3">
        {draft.conditions.map((condition, index) => (
          <div key={index} className="rounded-xl border border-subtle bg-layer-1 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
              <label><FieldLabel>{t("project_settings.features.intake.builder.condition_target")}</FieldLabel><select className={controlClass} value={condition.target_field_id} onChange={(event) => change(index, { ...condition, target_field_id: event.target.value })}>{draft.field_schema.map((field) => <option key={field.id} value={field.id}>{fieldName(field)}</option>)}</select></label>
              <label><FieldLabel>{t("project_settings.features.intake.builder.condition_action")}</FieldLabel><select className={controlClass} value={condition.action} onChange={(event) => change(index, { ...condition, action: event.target.value as TIntakeFormCondition["action"] })}><option value="SHOW">{t("project_settings.features.intake.builder.condition_actions.SHOW")}</option><option value="HIDE">{t("project_settings.features.intake.builder.condition_actions.HIDE")}</option></select></label>
              <Button variant="secondary" size="lg" className="mt-[22px]" onClick={() => update("conditions", draft.conditions.filter((_item, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-subtle pt-4 text-11 text-secondary"><span>{t("project_settings.features.intake.builder.condition_match")}</span><select className="h-8 rounded-md border border-subtle bg-surface-2 px-2 text-11 text-primary" value={condition.match} onChange={(event) => change(index, { ...condition, match: event.target.value as TIntakeFormCondition["match"] })}><option value="ALL">{t("project_settings.features.intake.builder.condition_matches.ALL")}</option><option value="ANY">{t("project_settings.features.intake.builder.condition_matches.ANY")}</option></select></div>
            <div className="mt-3 space-y-2">
              {condition.rules.map((rule, ruleIndex) => (
                <div key={ruleIndex} className="grid gap-2 rounded-lg bg-layer-2 p-3 sm:grid-cols-[1fr_150px_1fr_auto]">
                  <select className={controlClass} value={rule.field_id} onChange={(event) => change(index, { ...condition, rules: condition.rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, field_id: event.target.value } : item) })}>{draft.field_schema.filter((field) => field.id !== condition.target_field_id).map((field) => <option key={field.id} value={field.id}>{fieldName(field)}</option>)}</select>
                  <select className={controlClass} value={rule.operator} onChange={(event) => change(index, { ...condition, rules: condition.rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, operator: event.target.value as TIntakeFormConditionRule["operator"] } : item) })}>{operators.map((operator) => <option key={operator} value={operator}>{t(`project_settings.features.intake.builder.condition_operators.${operator}`)}</option>)}</select>
                  {rule.operator === "IS_EMPTY" || rule.operator === "IS_NOT_EMPTY" ? <div className="flex h-9 items-center px-3 text-11 text-tertiary">{t("project_settings.features.intake.builder.condition_no_value")}</div> : <input className={controlClass} value={String(rule.value ?? "")} onChange={(event) => change(index, { ...condition, rules: condition.rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, value: event.target.value } : item) })} placeholder={t("project_settings.features.intake.builder.condition_value")} />}
                  <Button variant="secondary" size="lg" disabled={condition.rules.length === 1} onClick={() => change(index, { ...condition, rules: condition.rules.filter((_item, itemIndex) => itemIndex !== ruleIndex) })}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-3 flex items-center gap-1.5 text-11 font-medium text-accent-primary" onClick={() => change(index, { ...condition, rules: [...condition.rules, { field_id: draft.field_schema.find((field) => field.id !== condition.target_field_id)?.id || firstFieldId, operator: "EQUALS", value: "" }] })}><Plus className="size-3.5" />{t("project_settings.features.intake.builder.add_rule")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutingStep({ draft, update, states, groups }: TStepProps & { states: IState[]; groups: TProjectUserGroup[] }) {
  const { t } = useTranslation();
  const publicStatuses = ["RECEIVED", "UNDER_REVIEW", "IN_PROGRESS", "COMPLETED", "REJECTED"];
  const setStatusMapping = (key: string, value: string) => update("public_status_mapping", { ...draft.public_status_mapping, [key]: value });
  const stateMapping = (draft.public_status_mapping.state_ids || {}) as Record<string, string>;
  const setStateMapping = (stateId: string, value: string) => update("public_status_mapping", { ...draft.public_status_mapping, state_ids: { ...stateMapping, [stateId]: value } });
  return (
    <div>
      <SectionIntro title={t("project_settings.features.intake.builder.steps.routing")} description={t("project_settings.features.intake.builder.help.routing")} />
      <div className="space-y-4">
        <label><FieldLabel>{t("project_settings.features.intake.builder.target_state")}</FieldLabel><select className={controlClass} value={draft.target_state} onChange={(event) => update("target_state", event.target.value)}>{states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label>
        <label><FieldLabel>{t("project_settings.features.intake.builder.reviewer_group")}</FieldLabel><select className={controlClass} value={draft.reviewer_group} onChange={(event) => update("reviewer_group", event.target.value)} disabled={!groups.length}><option value="">—</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        {!groups.length && <p className="rounded-lg bg-warning-subtle p-3 text-12 text-warning-primary">{t("project_settings.features.intake.builder.group_required")}</p>}
        <label><FieldLabel>{t("project_settings.features.intake.builder.max_attachments")}</FieldLabel><Input type="number" min={1} max={20} className="w-full" value={draft.max_attachments} onChange={(event) => update("max_attachments", Math.min(20, Math.max(1, Number(event.target.value))))} /></label>
        <CheckRow checked={draft.email_notifications_enabled} onChange={(checked) => { update("email_notifications_enabled", checked); if (checked) update("field_schema", draft.field_schema.map((field) => field.key === "requester_email" ? { ...field, visible: true, required: true } : field)); }} title={t("project_settings.features.intake.builder.email_notifications")} description={t("project_settings.features.intake.builder.email_notifications_help")} />
      </div>
      <div className="mt-6 border-t border-subtle pt-5"><h4 className="text-13 font-semibold text-primary">{t("project_settings.features.intake.builder.public_statuses")}</h4><p className="mt-1 text-11 text-secondary">{t("project_settings.features.intake.builder.public_statuses_help")}</p><div className="mt-3 space-y-2">{(["PENDING", "SNOOZED", "ACCEPTED", "REJECTED", "DUPLICATE"] as const).map((key) => <StatusMappingRow key={key} label={t(`project_settings.features.intake.builder.internal_statuses.${key}`)} value={String(draft.public_status_mapping[key] || "RECEIVED")} statuses={publicStatuses} onChange={(value) => setStatusMapping(key, value)} />)}</div></div>
      <div className="mt-6 border-t border-subtle pt-5"><h4 className="text-13 font-semibold text-primary">{t("project_settings.features.intake.builder.project_state_statuses")}</h4><p className="mt-1 text-11 text-secondary">{t("project_settings.features.intake.builder.project_state_statuses_help")}</p><div className="mt-3 space-y-2">{states.map((state) => <StatusMappingRow key={state.id} label={state.name} value={stateMapping[state.id] || "IN_PROGRESS"} statuses={publicStatuses} onChange={(value) => setStateMapping(state.id, value)} />)}</div></div>
    </div>
  );
}

function StatusMappingRow({ label, value, statuses, onChange }: { label: string; value: string; statuses: string[]; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return <label className="grid grid-cols-[1fr_180px] items-center gap-3 rounded-lg border border-subtle px-3 py-2"><span className="truncate text-12 text-primary">{label}</span><select className={controlClass} value={value} onChange={(event) => onChange(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{t(`project_settings.features.intake.builder.public_status_labels.${status}`)}</option>)}</select></label>;
}

function AppearanceStep({ draft, update }: TStepProps) {
  const { t } = useTranslation();
  const setBranding = (key: string, value: string) => update("branding", { ...draft.branding, [key]: value });
  const setTranslation = (locale: string, key: string, value: string) => update("translations", { ...draft.translations, [locale]: { ...(draft.translations[locale] || {}), [key]: value } });
  return <div><SectionIntro title={t("project_settings.features.intake.builder.steps.appearance")} description={t("project_settings.features.intake.builder.help.appearance")} /><div className="space-y-4"><label><FieldLabel>{t("project_settings.features.intake.builder.accent_color")}</FieldLabel><div className="flex gap-2"><input type="color" className="h-9 w-12 rounded-md border border-subtle bg-transparent p-1" value={draft.branding.accent_color || "#22A06B"} onChange={(e) => setBranding("accent_color", e.target.value)} /><Input className="flex-1" value={draft.branding.accent_color || ""} onChange={(e) => setBranding("accent_color", e.target.value)} /></div></label><label><FieldLabel>{t("project_settings.features.intake.builder.header_image")}</FieldLabel><Input className="w-full" value={draft.branding.header_image || ""} onChange={(e) => setBranding("header_image", e.target.value)} placeholder="https://..." /></label><label><FieldLabel>{t("project_settings.features.intake.builder.logo_url")}</FieldLabel><Input className="w-full" value={draft.branding.logo_url || ""} onChange={(e) => setBranding("logo_url", e.target.value)} placeholder="https://..." /></label><label><FieldLabel>{t("project_settings.features.intake.builder.success_message")}</FieldLabel><textarea className={cn(controlClass, "h-20 py-2")} value={draft.branding.success_message || ""} onChange={(e) => setBranding("success_message", e.target.value)} /></label></div><div className="mt-6 border-t border-subtle pt-5"><h4 className="text-13 font-semibold text-primary">{t("project_settings.features.intake.builder.locale_content")}</h4><p className="mt-1 text-11 text-secondary">{t("project_settings.features.intake.builder.locale_content_help")}</p><div className="mt-3 space-y-3">{(["ru", "uz", "en"] as const).map((locale) => <div key={locale} className="rounded-lg border border-subtle p-3"><div className="mb-2 text-11 font-semibold uppercase text-tertiary">{locale}</div><Input className="w-full" value={draft.translations[locale]?.name || ""} onChange={(e) => setTranslation(locale, "name", e.target.value)} placeholder={t("project_settings.features.intake.builder.localized_name")} /><textarea className={cn(controlClass, "mt-2 h-16 py-2")} value={draft.translations[locale]?.description || ""} onChange={(e) => setTranslation(locale, "description", e.target.value)} placeholder={t("project_settings.features.intake.builder.localized_description")} /><textarea className={cn(controlClass, "mt-2 h-16 py-2")} value={draft.translations[locale]?.success_message || ""} onChange={(e) => setTranslation(locale, "success_message", e.target.value)} placeholder={t("project_settings.features.intake.builder.localized_success_message")} />{draft.field_schema.filter((field) => field.source === "CUSTOM").length > 0 && <div className="mt-3 border-t border-subtle pt-3"><p className="mb-2 text-11 font-medium text-secondary">{t("project_settings.features.intake.builder.localized_field_labels")}</p><div className="space-y-2">{draft.field_schema.filter((field) => field.source === "CUSTOM").map((field) => <Input key={field.id} className="w-full" value={draft.translations[locale]?.[`field.${field.id}.label`] || ""} onChange={(event) => setTranslation(locale, `field.${field.id}.label`, event.target.value)} placeholder={field.name || field.key} />)}</div></div>}</div>)}</div></div></div>;
}

function FormPreview({ draft }: { draft: TIntakeFormPayload }) {
  const { t } = useTranslation();
  const visibleFields = draft.field_schema.filter((field) => field.visible).slice(0, 5);
  return <div className="overflow-hidden rounded-xl border border-subtle bg-surface-2 shadow-raised-100"><div className="h-20 bg-layer-3 bg-cover bg-center" style={draft.branding.header_image ? { backgroundImage: `url(${draft.branding.header_image})` } : { background: `linear-gradient(135deg, ${draft.branding.accent_color || "#22A06B"}, #132F2B)` }} /><div className="p-4"><div className="flex items-center gap-2">{draft.branding.logo_url && <img src={draft.branding.logo_url} alt="" className="size-8 rounded-lg object-cover" />}<div><h4 className="text-14 font-semibold text-primary">{draft.name || t("project_settings.features.intake.builder.untitled")}</h4><p className="line-clamp-2 text-11 text-secondary">{draft.description}</p></div></div><div className="mt-4 space-y-3">{visibleFields.map((field) => <div key={field.id}><div className="mb-1 text-10 font-medium text-secondary">{field.source === "CUSTOM" ? field.name : t(fieldLabelKey(field))}{field.required && " *"}</div><div className={cn("rounded-md border border-subtle bg-layer-1", field.key === "description" ? "h-14" : "h-8")} /></div>)}</div><div className="mt-4 h-8 rounded-md" style={{ backgroundColor: draft.branding.accent_color || "#22A06B" }} /></div></div>;
}

function CheckRow({ checked, onChange, title, description }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description: string }) { return <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-subtle p-3"><div><div className="text-12 font-medium text-primary">{title}</div><p className="mt-1 text-11 text-secondary">{description}</p></div><input type="checkbox" className="mt-1 size-4 accent-[var(--color-accent-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>; }
function MiniCheck({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) { return <label className={cn("flex items-center gap-1.5 text-11 text-secondary", disabled && "opacity-50")}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>; }

function FormActionModal({ state, workspaceSlug, projectId, onClose, onCompleted }: { state: TConfirmState | null; workspaceSlug: string; projectId: string; onClose: () => void; onCompleted: () => Promise<void> }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const submit = async () => { if (!state) return; setLoading(true); try { if (state.action === "archive") await intakeService.archiveForm(workspaceSlug, projectId, state.form.id); if (state.action === "restore") await intakeService.restoreForm(workspaceSlug, projectId, state.form.id); if (state.action === "delete") await intakeService.deleteForm(workspaceSlug, projectId, state.form.id); await onCompleted(); } catch { setToast({ type: TOAST_TYPE.ERROR, title: t("project_settings.features.intake.builder.action_error"), message: t("project_settings.features.intake.builder.save_error") }); } finally { setLoading(false); } };
  return <ModalCore isOpen={Boolean(state)} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.LG}><div className="p-5"><div className="flex size-10 items-center justify-center rounded-lg bg-warning-subtle text-warning-primary">{state?.action === "restore" ? <RotateCcw className="size-5" /> : state?.action === "delete" ? <Trash2 className="size-5" /> : <Archive className="size-5" />}</div><h2 className="mt-4 text-18 font-semibold text-primary">{t(`project_settings.features.intake.builder.confirm.${state?.action || "archive"}.title`)}</h2><p className="mt-2 text-13 text-secondary">{state?.form.name}. {t(`project_settings.features.intake.builder.confirm.${state?.action || "archive"}.description`)}</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>{t("cancel")}</Button><Button variant={state?.action === "delete" ? "error-fill" : "primary"} loading={loading} onClick={() => void submit()}>{t(`project_settings.features.intake.builder.confirm.${state?.action || "archive"}.action`)}</Button></div></div></ModalCore>;
}

export default observer(FeaturesIntakeSettingsPage);
