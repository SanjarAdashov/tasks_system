/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import useSWR from "swr";
import { v4 as uuidv4 } from "uuid";
import { getIntlLocale, useTranslation } from "@plane/i18n";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type {
  IState,
  TProjectStateTransitionRule,
  TProjectStateTransitionRulePayload,
  TProjectWorkItemProperty,
  TProjectUserGroup,
  TStateTransitionCondition,
  TStateTransitionConditionGroup,
  TStateTransitionConditionNode,
  TStateTransitionConditionOperator,
  TStateTransitionEvaluation,
} from "@plane/types";
import { Button, Input, Loader, ToggleSwitch } from "@plane/ui";
import { ProjectService, ProjectStateService } from "@/services/project";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

type TTab = "rules" | "audit" | "preview";

const EMPTY_TREE = (): TStateTransitionConditionGroup => ({
  id: uuidv4(),
  kind: "group",
  operator: "AND",
  children: [],
});

const NEW_CONDITION = (): TStateTransitionCondition => ({
  id: uuidv4(),
  kind: "condition",
  field: "description",
  operator: "IS_SET",
});

const VALUELESS_OPERATORS = new Set<TStateTransitionConditionOperator>([
  "IS_SET",
  "IS_NOT_SET",
  "ALL_COMPLETED",
  "HAS_INCOMPLETE",
]);

const OPERATORS: Array<{ value: TStateTransitionConditionOperator; label: string }> = [
  { value: "IS_SET", label: "project_settings.state_transitions.operators.is_set" },
  { value: "IS_NOT_SET", label: "project_settings.state_transitions.operators.is_not_set" },
  { value: "EQ", label: "project_settings.state_transitions.operators.eq" },
  { value: "NEQ", label: "project_settings.state_transitions.operators.neq" },
  { value: "BEFORE", label: "project_settings.state_transitions.operators.before" },
  { value: "AFTER", label: "project_settings.state_transitions.operators.after" },
  { value: "CONTAINS", label: "project_settings.state_transitions.operators.contains" },
  { value: "NOT_CONTAINS", label: "project_settings.state_transitions.operators.not_contains" },
  { value: "ALL_COMPLETED", label: "project_settings.state_transitions.operators.all_completed" },
  { value: "HAS_INCOMPLETE", label: "project_settings.state_transitions.operators.has_incomplete" },
];

const BUILT_IN_FIELDS = [
  ["name", "title"],
  ["description", "description"],
  ["priority", "priority"],
  ["state", "status"],
  ["assignees", "assignees"],
  ["labels", "labels"],
  ["start_date", "start_date"],
  ["target_date", "due_date"],
  ["cycle", "cycle"],
  ["module", "module"],
  ["estimate", "estimate"],
  ["parent", "parent"],
  ["created_by", "creator"],
  ["attachments", "attachments"],
  ["comments", "comments"],
  ["subtasks", "subtasks"],
  ["dependencies", "dependencies"],
  ["actor.user", "current_user"],
  ["actor.role", "current_user_role"],
  ["actor.is_assignee", "current_user_assignee"],
  ["actor.is_creator", "current_user_creator"],
] as const;

const ensureNodeIds = (node: TStateTransitionConditionNode): TStateTransitionConditionNode => {
  if (node.kind === "condition") return { ...node, id: node.id || uuidv4() };
  return {
    ...node,
    id: node.id || uuidv4(),
    children: node.children.map(ensureNodeIds),
  };
};

const updateNode = (
  root: TStateTransitionConditionGroup,
  nodeId: string,
  updater: (node: TStateTransitionConditionNode) => TStateTransitionConditionNode
): TStateTransitionConditionGroup => {
  const visit = (node: TStateTransitionConditionNode): TStateTransitionConditionNode => {
    if (node.id === nodeId) return updater(node);
    if (node.kind === "condition") return node;
    return { ...node, children: node.children.map(visit) };
  };
  return visit(root) as TStateTransitionConditionGroup;
};

const removeNode = (root: TStateTransitionConditionGroup, nodeId: string): TStateTransitionConditionGroup => {
  const visit = (group: TStateTransitionConditionGroup): TStateTransitionConditionGroup => ({
    ...group,
    children: group.children
      .filter((child) => child.id !== nodeId)
      .map((child) => (child.kind === "group" ? visit(child) : child)),
  });
  return visit(root);
};

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

const parseConditionValue = (field: string, rawValue: string): unknown => {
  if (field === "actor.is_assignee" || field === "actor.is_creator" || field.startsWith("actor.member_property:"))
    return rawValue === "true";
  if (field === "actor.role" || field === "attachments" || field === "comments" || field === "estimate")
    return rawValue ? Number(rawValue) : "";
  return rawValue;
};

type ConditionTreeProps = {
  title: string;
  value: TStateTransitionConditionGroup;
  onChange: (tree: TStateTransitionConditionGroup) => void;
  states: IState[];
  properties: TProjectWorkItemProperty[];
  groups: TProjectUserGroup[];
};

function ConditionTreeEditor({ title, value, onChange, states, properties, groups }: ConditionTreeProps) {
  const { t } = useTranslation();
  const memberProperties = properties.filter(
    (property) =>
      property.select_source === "MEMBERS" &&
      (property.property_type === "SINGLE_SELECT" || property.property_type === "MULTI_SELECT")
  );
  const fieldOptions = [
    ...BUILT_IN_FIELDS.map(([fieldValue, labelKey]) => ({
      value: fieldValue,
      label: t(`project_settings.state_transitions.editor.fields.${labelKey}`),
    })),
    ...properties.map((property) => ({ value: `custom:${property.id}`, label: property.name })),
    ...memberProperties.map((property) => ({
      value: `actor.member_property:${property.id}`,
      label: t("project_settings.state_transitions.editor.current_user_property", { property: property.name }),
    })),
    { value: "actor.group", label: t("project_settings.state_transitions.editor.actor_group") },
    { value: "created_by.group", label: t("project_settings.state_transitions.editor.creator_group") },
    { value: "assignees.group_any", label: t("project_settings.state_transitions.editor.any_assignee_group") },
    { value: "assignees.group_all", label: t("project_settings.state_transitions.editor.all_assignee_group") },
    ...memberProperties.flatMap((property) => [
      {
        value: `custom.group_any:${property.id}`,
        label: t("project_settings.state_transitions.editor.any_property_group", { property: property.name }),
      },
      {
        value: `custom.group_all:${property.id}`,
        label: t("project_settings.state_transitions.editor.all_property_group", { property: property.name }),
      },
    ]),
  ];

  const addCondition = (groupId: string) =>
    onChange(
      updateNode(value, groupId, (node) =>
        node.kind === "group" ? { ...node, children: [...node.children, NEW_CONDITION()] } : node
      )
    );

  const addGroup = (groupId: string) =>
    onChange(
      updateNode(value, groupId, (node) =>
        node.kind === "group"
          ? {
              ...node,
              children: [...node.children, { ...EMPTY_TREE(), children: [NEW_CONDITION()] }],
            }
          : node
      )
    );

  const renderConditionValue = (condition: TStateTransitionCondition) => {
    if (VALUELESS_OPERATORS.has(condition.operator)) return null;
    const isGroupField =
      condition.field.endsWith(".group") ||
      condition.field.includes(".group_any") ||
      condition.field.includes(".group_all");
    if (isGroupField)
      return (
        <select
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? groups.find((group) => !group.archived_at)?.id ?? "")}
          onChange={(event) =>
            onChange(
              updateNode(value, condition.id!, (node) =>
                node.kind === "condition" ? { ...node, value: event.target.value } : node
              )
            )
          }
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
              {group.archived_at ? ` (${t("project_settings.state_transitions.editor.archived_group")})` : ""}
            </option>
          ))}
        </select>
      );
    const booleanField =
      condition.field === "actor.is_assignee" ||
      condition.field === "actor.is_creator" ||
      condition.field.startsWith("actor.member_property:");
    if (booleanField)
      return (
        <select
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? true)}
          onChange={(event) =>
            onChange(
              updateNode(value, condition.id!, (node) =>
                node.kind === "condition" ? { ...node, value: event.target.value === "true" } : node
              )
            )
          }
        >
          <option value="true">{t("project_settings.state_transitions.editor.yes")}</option>
          <option value="false">{t("project_settings.state_transitions.editor.no")}</option>
        </select>
      );
    if (condition.field === "actor.role")
      return (
        <select
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? 15)}
          onChange={(event) =>
            onChange(
              updateNode(value, condition.id!, (node) =>
                node.kind === "condition" ? { ...node, value: Number(event.target.value) } : node
              )
            )
          }
        >
          <option value="5">{t("project_settings.state_transitions.editor.guest")}</option>
          <option value="15">{t("project_settings.state_transitions.editor.member")}</option>
          <option value="20">{t("project_settings.state_transitions.editor.project_admin")}</option>
        </select>
      );
    if (condition.field === "state")
      return (
        <select
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? states[0]?.id ?? "")}
          onChange={(event) =>
            onChange(
              updateNode(value, condition.id!, (node) =>
                node.kind === "condition" ? { ...node, value: event.target.value } : node
              )
            )
          }
        >
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </select>
      );

    const customProperty = condition.field.startsWith("custom:")
      ? properties.find((property) => property.id === condition.field.split(":")[1])
      : undefined;
    if (
      customProperty &&
      customProperty.select_source === "MANUAL" &&
      (customProperty.property_type === "SINGLE_SELECT" || customProperty.property_type === "MULTI_SELECT")
    )
      return (
        <select
          className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? customProperty.options[0]?.id ?? "")}
          onChange={(event) =>
            onChange(
              updateNode(value, condition.id!, (node) =>
                node.kind === "condition" ? { ...node, value: event.target.value } : node
              )
            )
          }
        >
          {customProperty.options
            .filter((option) => !option.archived_at)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
        </select>
      );

    return (
      <Input
        className="min-w-36"
        type={
          condition.operator === "BEFORE" ||
          condition.operator === "AFTER" ||
          condition.field === "start_date" ||
          condition.field === "target_date"
            ? "date"
            : "text"
        }
        value={typeof condition.value === "string" || typeof condition.value === "number" ? condition.value : ""}
        placeholder={t(
          condition.field === "actor.user"
            ? "project_settings.state_transitions.editor.user_uuid"
            : "project_settings.state_transitions.editor.value"
        )}
        onChange={(event) =>
          onChange(
            updateNode(value, condition.id!, (node) =>
              node.kind === "condition"
                ? { ...node, value: parseConditionValue(condition.field, event.target.value) }
                : node
            )
          )
        }
      />
    );
  };

  const renderNode = (node: TStateTransitionConditionNode, depth: number) => {
    if (node.kind === "condition")
      return (
        <div key={node.id} className="space-y-2 rounded border border-subtle bg-surface-1 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 min-w-44 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
              value={node.field}
              onChange={(event) =>
                onChange(
                  updateNode(value, node.id!, (current) =>
                    current.kind === "condition"
                      ? {
                          ...current,
                          field: event.target.value,
                          operator: event.target.value.includes(".group") ? "EQ" : "IS_SET",
                          value: event.target.value.includes(".group")
                            ? groups.find((group) => !group.archived_at)?.id
                            : undefined,
                        }
                      : current
                  )
                )
              }
            >
              {fieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="h-8 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
              value={node.operator}
              onChange={(event) =>
                onChange(
                  updateNode(value, node.id!, (current) =>
                    current.kind === "condition"
                      ? {
                          ...current,
                          operator: event.target.value as TStateTransitionConditionOperator,
                          value: VALUELESS_OPERATORS.has(event.target.value as TStateTransitionConditionOperator)
                            ? undefined
                            : current.value,
                        }
                      : current
                  )
                )
              }
            >
              {OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {t(operator.label)}
                </option>
              ))}
            </select>
            {renderConditionValue(node)}
            <button
              type="button"
              className="ml-auto grid size-8 place-items-center rounded text-tertiary hover:bg-danger-subtle hover:text-danger-primary"
              onClick={() => onChange(removeNode(value, node.id!))}
              aria-label={t("project_settings.state_transitions.editor.remove_condition")}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <Input
            value={node.message ?? ""}
            placeholder={t("project_settings.state_transitions.editor.optional_message")}
            onChange={(event) =>
              onChange(
                updateNode(value, node.id!, (current) =>
                  current.kind === "condition" ? { ...current, message: event.target.value } : current
                )
              )
            }
          />
        </div>
      );

    return (
      <div key={node.id} className={depth ? "space-y-2 rounded border border-subtle bg-surface-2 p-3" : "space-y-2"}>
        <div className="flex items-center gap-2">
          <span className="text-11 font-medium text-tertiary">
            {depth ? t("project_settings.state_transitions.editor.nested_group") : title}
          </span>
          <select
            className="h-7 rounded border border-subtle bg-surface-1 px-2 text-11 text-primary"
            value={node.operator}
            onChange={(event) =>
              onChange(
                updateNode(value, node.id!, (current) =>
                  current.kind === "group" ? { ...current, operator: event.target.value as "AND" | "OR" } : current
                )
              )
            }
          >
            <option value="AND">{t("project_settings.state_transitions.editor.all_conditions")}</option>
            <option value="OR">{t("project_settings.state_transitions.editor.any_condition")}</option>
          </select>
          {depth > 0 && (
            <button
              type="button"
              className="ml-auto grid size-7 place-items-center rounded text-tertiary hover:bg-danger-subtle hover:text-danger-primary"
              onClick={() => onChange(removeNode(value, node.id!))}
              aria-label={t("project_settings.state_transitions.editor.remove_group")}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        {node.children.map((child) => renderNode(child, depth + 1))}
        <div className="flex gap-2">
          <Button variant="neutral-primary" size="sm" prependIcon={<Plus />} onClick={() => addCondition(node.id!)}>
            {t("project_settings.state_transitions.add_condition")}
          </Button>
          <Button
            variant="neutral-primary"
            size="sm"
            prependIcon={<Plus />}
            onClick={() => addGroup(node.id!)}
            disabled={depth >= 7}
          >
            {t("project_settings.state_transitions.add_group")}
          </Button>
        </div>
      </div>
    );
  };

  return <div className="rounded border border-subtle p-3">{renderNode(value, 0)}</div>;
}

type RuleFormProps = {
  workspaceSlug: string;
  projectId: string;
  states: IState[];
  properties: TProjectWorkItemProperty[];
  groups: TProjectUserGroup[];
  rule?: TProjectStateTransitionRule;
  onCancel: () => void;
  onSaved: (rule: TProjectStateTransitionRule) => void;
};

function RuleForm({ workspaceSlug, projectId, states, properties, groups, rule, onCancel, onSaved }: RuleFormProps) {
  const { t } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const [payload, setPayload] = useState<TProjectStateTransitionRulePayload>(() => ({
    source_type: rule?.source_type ?? "EXACT",
    source_state: rule?.source_state ?? states[0]?.id ?? null,
    target_state: rule?.target_state ?? states[1]?.id ?? states[0]?.id ?? "",
    allow_conditions: ensureNodeIds(rule?.allow_conditions ?? EMPTY_TREE()) as TStateTransitionConditionGroup,
    deny_conditions: ensureNodeIds(rule?.deny_conditions ?? EMPTY_TREE()) as TStateTransitionConditionGroup,
    validation_conditions: ensureNodeIds(rule?.validation_conditions ?? EMPTY_TREE()) as TStateTransitionConditionGroup,
    project_admin_bypass: rule?.project_admin_bypass ?? false,
    system_bypass: rule?.system_bypass ?? false,
  }));
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    setIsSaving(true);
    try {
      const saved = rule
        ? await service.updateStateTransitionRule(workspaceSlug, projectId, rule.id, payload)
        : await service.createStateTransitionRule(workspaceSlug, projectId, payload);
      onSaved(saved);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: t("project_settings.state_transitions.saved"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: formatError(error, t("project_settings.state_transitions.editor.try_again")),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5 rounded-lg border border-subtle bg-surface-1 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-11 font-medium text-secondary">
          {t("project_settings.state_transitions.editor.transition_type")}
          <select
            className="h-9 w-full rounded border border-subtle bg-surface-1 px-2 text-13 text-primary"
            value={payload.source_type}
            onChange={(event) =>
              setPayload((current) => ({
                ...current,
                source_type: event.target.value as TProjectStateTransitionRulePayload["source_type"],
                source_state: event.target.value === "EXACT" ? (states[0]?.id ?? null) : null,
              }))
            }
          >
            <option value="EXACT">{t("project_settings.state_transitions.exact")}</option>
            <option value="ANY">{t("project_settings.state_transitions.any")}</option>
            <option value="CREATE">{t("project_settings.state_transitions.create")}</option>
          </select>
        </label>
        <label className="space-y-1 text-11 font-medium text-secondary">
          {t("project_settings.state_transitions.source")}
          <select
            className="h-9 w-full rounded border border-subtle bg-surface-1 px-2 text-13 text-primary disabled:text-tertiary"
            value={payload.source_state ?? ""}
            disabled={payload.source_type !== "EXACT"}
            onChange={(event) => setPayload((current) => ({ ...current, source_state: event.target.value }))}
          >
            {payload.source_type !== "EXACT" && (
              <option value="">
                {payload.source_type === "CREATE"
                  ? t("project_settings.state_transitions.create")
                  : t("project_settings.state_transitions.any")}
              </option>
            )}
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-11 font-medium text-secondary">
          {t("project_settings.state_transitions.target")}
          <select
            className="h-9 w-full rounded border border-subtle bg-surface-1 px-2 text-13 text-primary"
            value={payload.target_state}
            onChange={(event) => setPayload((current) => ({ ...current, target_state: event.target.value }))}
          >
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ConditionTreeEditor
        title={t("project_settings.state_transitions.allow")}
        value={payload.allow_conditions}
        onChange={(allow_conditions) => setPayload((current) => ({ ...current, allow_conditions }))}
        states={states}
        properties={properties}
        groups={groups}
      />
      <ConditionTreeEditor
        title={t("project_settings.state_transitions.deny")}
        value={payload.deny_conditions}
        onChange={(deny_conditions) => setPayload((current) => ({ ...current, deny_conditions }))}
        states={states}
        properties={properties}
        groups={groups}
      />
      <ConditionTreeEditor
        title={t("project_settings.state_transitions.validation")}
        value={payload.validation_conditions}
        onChange={(validation_conditions) => setPayload((current) => ({ ...current, validation_conditions }))}
        states={states}
        properties={properties}
        groups={groups}
      />

      <div className="space-y-3 rounded border border-subtle bg-surface-2 p-3">
        <label className="flex items-center justify-between gap-4 text-12 text-primary">
          {t("project_settings.state_transitions.admin_bypass")}
          <ToggleSwitch
            value={payload.project_admin_bypass}
            onChange={(project_admin_bypass) => setPayload((current) => ({ ...current, project_admin_bypass }))}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-12 text-primary">
          {t("project_settings.state_transitions.system_bypass")}
          <ToggleSwitch
            value={payload.system_bypass}
            onChange={(system_bypass) => setPayload((current) => ({ ...current, system_bypass }))}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="neutral-primary" onClick={onCancel} disabled={isSaving}>
          {t("project_settings.state_transitions.cancel")}
        </Button>
        <Button onClick={save} loading={isSaving} disabled={!payload.target_state}>
          {t("project_settings.state_transitions.save")}
        </Button>
      </div>
    </div>
  );
}

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
  const { data: properties = [] } = useSWR(`STATE_TRANSITION_PROPERTIES_${workspaceSlug}_${projectId}`, () =>
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
      const saved = await service.updateStateTransitionSettings(workspaceSlug, projectId, {
        strict_mode: strictMode,
      });
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
    if (!window.confirm(t("project_settings.state_transitions.archive"))) return;
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

  return (
    <div className="space-y-5 pb-12">
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
        <>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-surface-2 p-4">
            <div>
              <div className="text-13 font-medium text-primary">
                {t("project_settings.state_transitions.strict_mode")}
              </div>
              <div className="mt-1 text-11 text-tertiary">
                {t("project_settings.state_transitions.strict_mode_help")}
              </div>
            </div>
            <ToggleSwitch value={settings.strict_mode} disabled={isSavingSettings} onChange={updateStrictMode} />
          </div>

          {(isCreating || editingRule) && (
            <RuleForm
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
          )}

          {!isCreating && !editingRule && (
            <div className="flex justify-end">
              <Button prependIcon={<Plus />} onClick={() => setIsCreating(true)}>
                {t("project_settings.state_transitions.new_rule")}
              </Button>
            </div>
          )}

          {rules.length ? (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-surface-1 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded bg-layer-1 px-2 py-1 text-11 font-medium text-secondary">
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
                    </div>
                    <ChevronRight className="size-4 text-tertiary" />
                    <div className="truncate text-13 font-medium text-primary">
                      {stateName(
                        states,
                        rule.target_state,
                        t("project_settings.state_transitions.editor.unknown_status")
                      )}
                    </div>
                    {(rule.project_admin_bypass || rule.system_bypass) && (
                      <span className="text-10 text-tertiary">
                        {rule.project_admin_bypass
                          ? t("project_settings.state_transitions.editor.admin_bypass_short")
                          : ""}
                        {rule.project_admin_bypass && rule.system_bypass ? " · " : ""}
                        {rule.system_bypass ? t("project_settings.state_transitions.editor.system_bypass_short") : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
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
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-subtle p-8 text-center text-12 text-tertiary">
              {t("project_settings.state_transitions.empty")}
            </div>
          )}
        </>
      )}

      {tab === "audit" && (
        <div className="space-y-2">
          {!auditLogs ? (
            <Loader className="space-y-2">
              <Loader.Item height="64px" width="100%" />
              <Loader.Item height="64px" width="100%" />
            </Loader>
          ) : auditLogs.length ? (
            <>
              <div className="flex justify-end">
                <Button variant="neutral-primary" size="sm" onClick={() => mutateAuditLogs()}>
                  {t("project_settings.state_transitions.editor.refresh")}
                </Button>
              </div>
              {auditLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-subtle p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-12 font-medium text-primary">
                      {t(
                        log.action === "TRANSITION_DENIED"
                          ? "project_settings.state_transitions.editor.denied_transition"
                          : "project_settings.state_transitions.editor.configuration_changed"
                      )}
                    </span>
                    <time className="text-10 text-tertiary">
                      {new Date(log.created_at).toLocaleString(getIntlLocale(currentLocale), { hour12: false })}
                    </time>
                  </div>
                  <div className="mt-1 text-11 text-secondary">
                    {t("project_settings.state_transitions.editor.actor")}:{" "}
                    {log.actor_id ?? t("project_settings.state_transitions.editor.system")} ·{" "}
                    {t("project_settings.state_transitions.editor.work_item")}: {log.issue ?? "—"}
                  </div>
                  <pre className="mt-2 overflow-auto rounded bg-surface-2 p-2 text-10 whitespace-pre-wrap text-tertiary">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </div>
              ))}
            </>
          ) : (
            <div className="rounded border border-dashed border-subtle p-8 text-center text-12 text-tertiary">
              {t("project_settings.state_transitions.editor.audit_empty")}
            </div>
          )}
        </div>
      )}

      {tab === "preview" && (
        <div className="space-y-4 rounded-lg border border-subtle p-4">
          <div className="flex items-center justify-between gap-4 text-12 text-primary">
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
          {previewResult && (
            <div
              className={`rounded border p-3 ${
                previewResult.allowed
                  ? "border-success-subtle bg-success-subtle"
                  : "border-danger-subtle bg-danger-subtle"
              }`}
            >
              <div className="text-13 font-medium text-primary">
                {t(
                  previewResult.allowed
                    ? "project_settings.state_transitions.editor.allowed"
                    : "project_settings.state_transitions.editor.denied"
                )}
              </div>
              {previewResult.reasons.map((reason) => (
                <div key={reason} className="mt-1 text-12 text-secondary">
                  {reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
