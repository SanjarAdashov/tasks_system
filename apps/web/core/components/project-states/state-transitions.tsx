/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Pencil, Plus, ShieldCheck } from "lucide-react";
import useSWR from "swr";
import { getIntlLocale, useTranslation } from "@plane/i18n";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type {
  IState,
  TProjectStateTransitionRule,
  TStateTransitionConditionGroup,
  TStateTransitionEvaluation,
} from "@plane/types";
import { Button, Input, Loader, ToggleSwitch } from "@plane/ui";
import { getProjectWorkItemPropertiesSWRKey } from "@/components/issues/work-item-properties";
import { SettingsHeading } from "@/components/settings/heading";
import { ProjectService, ProjectStateService } from "@/services/project";
import { StateTransitionRuleEditor } from "./state-transition-rule-editor";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

type TTab = "rules" | "audit" | "preview";

const formatError = (error: unknown, fallback: string): string => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const first = Object.values(error)[0];
  if (typeof first === "string") return first;
  if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  return formatError(first, fallback);
};

const stateName = (states: IState[], stateId: string | null, unknownLabel: string) =>
  states.find((state) => state.id === stateId)?.name ?? unknownLabel;

const countConditions = (group: TStateTransitionConditionGroup): number =>
  group.children.reduce((total, child) => total + (child.kind === "condition" ? 1 : countConditions(child)), 0);

export function StateTransitionSettings({ workspaceSlug, projectId }: Props) {
  const { t, currentLocale } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const stateService = useMemo(() => new ProjectStateService(), []);
  const [tab, setTab] = useState<TTab>("rules");
  const [editingRule, setEditingRule] = useState<TProjectStateTransitionRule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [previewIssueId, setPreviewIssueId] = useState("");
  const [previewActorId, setPreviewActorId] = useState("");
  const [previewTargetId, setPreviewTargetId] = useState("");
  const [previewIsCreation, setPreviewIsCreation] = useState(false);
  const [previewResult, setPreviewResult] = useState<TStateTransitionEvaluation | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const { data: states } = useSWR(`STATE_TRANSITION_STATES_${workspaceSlug}_${projectId}`, () =>
    stateService.getStates(workspaceSlug, projectId)
  );
  const { data: properties = [] } = useSWR(getProjectWorkItemPropertiesSWRKey(workspaceSlug, projectId), () =>
    service.getWorkItemProperties(workspaceSlug, projectId)
  );
  const { data: groups = [] } = useSWR(`STATE_TRANSITION_GROUPS_${workspaceSlug}_${projectId}`, () =>
    service.getUserGroups(workspaceSlug, projectId, true)
  );
  const { data: settings, mutate: mutateSettings } = useSWR(
    `STATE_TRANSITION_SETTINGS_${workspaceSlug}_${projectId}`,
    () => service.getStateTransitionSettings(workspaceSlug, projectId)
  );
  const { data: rules, mutate: mutateRules } = useSWR(`STATE_TRANSITION_RULES_${workspaceSlug}_${projectId}`, () =>
    service.getStateTransitionRules(workspaceSlug, projectId)
  );
  const { data: auditLogs, mutate: mutateAuditLogs } = useSWR(
    tab === "audit" ? `STATE_TRANSITION_AUDIT_${workspaceSlug}_${projectId}` : null,
    () => service.getStateTransitionAuditLogs(workspaceSlug, projectId)
  );

  useEffect(() => {
    if (!previewTargetId && states?.[0]) setPreviewTargetId(states[0].id);
  }, [previewTargetId, states]);

  const updateStrictMode = async (strictMode: boolean) => {
    setIsSavingSettings(true);
    try {
      const saved = await service.updateStateTransitionSettings(workspaceSlug, projectId, { strict_mode: strictMode });
      await mutateSettings(saved, { revalidate: false });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: formatError(error, t("project_settings.state_transitions.editor.try_again")),
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const archiveRule = async (rule: TProjectStateTransitionRule) => {
    if (!window.confirm(t("project_settings.state_transitions.editor.archive_confirmation"))) return;
    try {
      await service.archiveStateTransitionRule(workspaceSlug, projectId, rule.id);
      await mutateRules((current) => current?.filter((item) => item.id !== rule.id), { revalidate: false });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: t("project_settings.state_transitions.archived"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: formatError(error, t("project_settings.state_transitions.editor.try_again")),
      });
    }
  };

  const handleSaved = async (savedRule: TProjectStateTransitionRule) => {
    await mutateRules(
      (current) => {
        const existing = current ?? [];
        return existing.some((rule) => rule.id === savedRule.id)
          ? existing.map((rule) => (rule.id === savedRule.id ? savedRule : rule))
          : [...existing, savedRule];
      },
      { revalidate: false }
    );
    setEditingRule(null);
    setIsCreating(false);
  };

  const runPreview = async () => {
    if (!previewTargetId) return;
    setIsPreviewing(true);
    try {
      const result = await service.previewStateTransition(workspaceSlug, projectId, {
        target_state_id: previewTargetId,
        issue_id: previewIsCreation ? undefined : previewIssueId || undefined,
        actor_id: previewActorId || undefined,
        is_creation: previewIsCreation,
      });
      setPreviewResult(result);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: formatError(error, t("project_settings.state_transitions.editor.try_again")),
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  if (!states || !rules || !settings)
    return (
      <Loader className="space-y-3">
        <Loader.Item height="64px" width="100%" />
        <Loader.Item height="84px" width="100%" />
        <Loader.Item height="84px" width="100%" />
      </Loader>
    );

  if (isCreating || editingRule)
    return (
      <StateTransitionRuleEditor
        key={editingRule?.id ?? "new-rule"}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        states={states}
        properties={properties}
        groups={groups}
        rule={editingRule ?? undefined}
        onCancel={() => {
          setIsCreating(false);
          setEditingRule(null);
        }}
        onSaved={handleSaved}
      />
    );

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SettingsHeading
          title={t("project_settings.state_transitions.heading")}
          description={t("project_settings.state_transitions.description")}
        />
        {tab === "rules" && (
          <Button prependIcon={<Plus />} onClick={() => setIsCreating(true)}>
            {t("project_settings.state_transitions.new_rule")}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-subtle">
        {(["rules", "audit", "preview"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`border-b-2 px-3 py-2 text-12 font-medium ${
              tab === item ? "border-accent-primary text-primary" : "border-transparent text-tertiary"
            }`}
            onClick={() => setTab(item)}
          >
            {t(`project_settings.state_transitions.${item}`)}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-subtle bg-surface-2 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-lg ${settings.strict_mode ? "bg-warning-subtle text-warning-primary" : "bg-success-subtle text-success-primary"}`}
              >
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <div className="text-13 font-semibold text-primary">
                  {t(
                    settings.strict_mode
                      ? "project_settings.state_transitions.editor.default_deny"
                      : "project_settings.state_transitions.editor.default_allow"
                  )}
                </div>
                <div className="mt-1 max-w-2xl text-11 text-tertiary">
                  {t(
                    settings.strict_mode
                      ? "project_settings.state_transitions.editor.default_deny_help"
                      : "project_settings.state_transitions.editor.default_allow_help"
                  )}
                </div>
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-3 text-11 font-medium text-secondary">
              {t("project_settings.state_transitions.editor.strict_mode_label")}
              <ToggleSwitch value={settings.strict_mode} disabled={isSavingSettings} onChange={updateStrictMode} />
            </label>
          </div>

          {rules.length ? (
            <div className="space-y-3">
              {rules.map((rule) => {
                const allowCount = countConditions(rule.allow_conditions);
                const denyCount = countConditions(rule.deny_conditions);
                const validationCount = countConditions(rule.validation_conditions);
                return (
                  <article
                    key={rule.id}
                    className="rounded-xl border border-subtle bg-surface-1 p-4 transition-colors hover:border-strong"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2 text-14 font-semibold text-primary">
                          <span className="truncate rounded-md bg-layer-1 px-2.5 py-1">
                            {rule.source_type === "EXACT"
                              ? stateName(
                                  states,
                                  rule.source_state,
                                  t("project_settings.state_transitions.editor.unknown_status")
                                )
                              : t(
                                  rule.source_type === "CREATE"
                                    ? "project_settings.state_transitions.create"
                                    : "project_settings.state_transitions.any"
                                )}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-tertiary" />
                          <span className="truncate">
                            {stateName(
                              states,
                              rule.target_state,
                              t("project_settings.state_transitions.editor.unknown_status")
                            )}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-layer-1 px-2.5 py-1 text-10 text-secondary">
                            {t("project_settings.state_transitions.editor.rule_allow_count", { count: allowCount })}
                          </span>
                          <span className="rounded-full bg-layer-1 px-2.5 py-1 text-10 text-secondary">
                            {t("project_settings.state_transitions.editor.rule_deny_count", { count: denyCount })}
                          </span>
                          <span className="rounded-full bg-layer-1 px-2.5 py-1 text-10 text-secondary">
                            {t("project_settings.state_transitions.editor.rule_validation_count", {
                              count: validationCount,
                            })}
                          </span>
                          {(rule.project_admin_bypass || rule.system_bypass) && (
                            <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-10 text-accent-primary">
                              {[
                                rule.project_admin_bypass
                                  ? t("project_settings.state_transitions.editor.admin_bypass_short")
                                  : "",
                                rule.system_bypass
                                  ? t("project_settings.state_transitions.editor.system_bypass_short")
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="neutral-primary"
                          size="sm"
                          prependIcon={<Pencil />}
                          onClick={() => setEditingRule(rule)}
                        >
                          {t("project_settings.state_transitions.edit")}
                        </Button>
                        <Button
                          variant="neutral-primary"
                          size="sm"
                          prependIcon={<Archive />}
                          onClick={() => archiveRule(rule)}
                        >
                          {t("project_settings.state_transitions.archive")}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-subtle px-6 py-12 text-center">
              <div className="text-13 font-semibold text-primary">{t("project_settings.state_transitions.empty")}</div>
              <div className="mt-1 text-11 text-tertiary">
                {t("project_settings.state_transitions.editor.empty_help")}
              </div>
              <Button className="mt-4" prependIcon={<Plus />} onClick={() => setIsCreating(true)}>
                {t("project_settings.state_transitions.new_rule")}
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div className="space-y-3">
          {!auditLogs ? (
            <Loader className="space-y-2">
              <Loader.Item height="72px" width="100%" />
              <Loader.Item height="72px" width="100%" />
            </Loader>
          ) : auditLogs.length ? (
            <>
              <div className="flex justify-end">
                <Button variant="neutral-primary" size="sm" onClick={() => mutateAuditLogs()}>
                  {t("project_settings.state_transitions.editor.refresh")}
                </Button>
              </div>
              {auditLogs.map((log) => (
                <article key={log.id} className="rounded-xl border border-subtle p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="text-12 font-semibold text-primary">
                        {t(
                          log.action === "TRANSITION_DENIED"
                            ? "project_settings.state_transitions.editor.denied_transition"
                            : "project_settings.state_transitions.editor.configuration_changed"
                        )}
                      </span>
                      <div className="mt-1 text-11 text-secondary">
                        {t("project_settings.state_transitions.editor.actor")}:{" "}
                        {log.actor_id ?? t("project_settings.state_transitions.editor.system")} ·{" "}
                        {t("project_settings.state_transitions.editor.work_item")}: {log.issue ?? "—"}
                      </div>
                    </div>
                    <time className="text-10 text-tertiary">
                      {new Date(log.created_at).toLocaleString(getIntlLocale(currentLocale), { hour12: false })}
                    </time>
                  </div>
                  <details className="mt-3 rounded-lg bg-surface-2 text-10 text-tertiary">
                    <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-medium text-secondary">
                      <ChevronDown className="size-3.5" />
                      {t("project_settings.state_transitions.editor.technical_details")}
                    </summary>
                    <pre className="overflow-auto border-t border-subtle p-3 whitespace-pre-wrap">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </details>
                </article>
              ))}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-subtle p-10 text-center text-12 text-tertiary">
              {t("project_settings.state_transitions.editor.audit_empty")}
            </div>
          )}
        </div>
      )}

      {tab === "preview" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
          <section className="space-y-4 rounded-xl border border-subtle p-5">
            <div>
              <h2 className="text-14 font-semibold text-primary">
                {t("project_settings.state_transitions.editor.preview_title")}
              </h2>
              <p className="mt-1 text-11 text-tertiary">
                {t("project_settings.state_transitions.editor.preview_help")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-2 p-3 text-12 text-primary">
              {t("project_settings.state_transitions.editor.preview_creation")}
              <ToggleSwitch value={previewIsCreation} onChange={setPreviewIsCreation} />
            </div>
            {!previewIsCreation && (
              <label
                htmlFor="state-transition-preview-issue"
                className="block space-y-1 text-11 font-medium text-secondary"
              >
                {t("project_settings.state_transitions.editor.work_item_uuid")}
                <Input
                  id="state-transition-preview-issue"
                  value={previewIssueId}
                  onChange={(event) => setPreviewIssueId(event.target.value)}
                />
              </label>
            )}
            <label
              htmlFor="state-transition-preview-actor"
              className="block space-y-1 text-11 font-medium text-secondary"
            >
              {t("project_settings.state_transitions.editor.user_uuid_self")}
              <Input
                id="state-transition-preview-actor"
                value={previewActorId}
                onChange={(event) => setPreviewActorId(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-11 font-medium text-secondary">
              {t("project_settings.state_transitions.editor.target_status")}
              <select
                className="h-9 w-full rounded border border-subtle bg-surface-1 px-2 text-13 text-primary"
                value={previewTargetId}
                onChange={(event) => setPreviewTargetId(event.target.value)}
              >
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end">
              <Button
                onClick={runPreview}
                loading={isPreviewing}
                disabled={!previewTargetId || (!previewIsCreation && !previewIssueId)}
              >
                {t("project_settings.state_transitions.editor.run_preview")}
              </Button>
            </div>
          </section>
          <section className="rounded-xl border border-subtle bg-surface-2 p-5">
            <h2 className="text-14 font-semibold text-primary">
              {t("project_settings.state_transitions.editor.preview_result")}
            </h2>
            {previewResult ? (
              <div
                className={`mt-4 rounded-lg border p-4 ${previewResult.allowed ? "border-success-subtle bg-success-subtle" : "border-danger-subtle bg-danger-subtle"}`}
              >
                <div className="text-13 font-semibold text-primary">
                  {t(
                    previewResult.allowed
                      ? "project_settings.state_transitions.editor.allowed"
                      : "project_settings.state_transitions.editor.denied"
                  )}
                </div>
                {previewResult.reasons.map((reason) => (
                  <div key={reason} className="mt-2 text-12 text-secondary">
                    {reason}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-subtle px-4 py-10 text-center text-11 text-tertiary">
                {t("project_settings.state_transitions.editor.preview_empty")}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
