/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Circle, ListChecks, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useTranslation } from "@plane/i18n";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type {
  IState,
  TProjectStateTransitionRule,
  TProjectStateTransitionRulePayload,
  TProjectUserGroup,
  TProjectWorkItemProperty,
  TStateTransitionCondition,
  TStateTransitionConditionGroup,
  TStateTransitionConditionNode,
  TStateTransitionConditionOperator,
} from "@plane/types";
import { Button, Input, ToggleSwitch } from "@plane/ui";
import { ProjectService } from "@/services/project";

type TEditorSection = "transition" | "allow" | "deny" | "validation" | "exceptions";

type Props = {
  workspaceSlug: string;
  projectId: string;
  states: IState[];
  properties: TProjectWorkItemProperty[];
  groups: TProjectUserGroup[];
  rule?: TProjectStateTransitionRule;
  onCancel: () => void;
  onSaved: (rule: TProjectStateTransitionRule) => void;
};

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

const conditionDefaultsForField = (
  field: string,
  groups: TProjectUserGroup[]
): Pick<TStateTransitionCondition, "operator" | "value"> => {
  if (field === "actor.role") return { operator: "EQ", value: 15 };
  if (field === "actor.is_assignee" || field === "actor.is_creator" || field.startsWith("actor.member_property:"))
    return { operator: "EQ", value: true };
  if (field.includes(".group"))
    return {
      operator: "EQ",
      value: groups.find((group) => !group.archived_at)?.id,
    };
  return { operator: "IS_SET", value: undefined };
};

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
  return { ...node, id: node.id || uuidv4(), children: node.children.map(ensureNodeIds) };
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

const countConditions = (group: TStateTransitionConditionGroup): number =>
  group.children.reduce((total, child) => total + (child.kind === "condition" ? 1 : countConditions(child)), 0);

const hasInvalidCondition = (group: TStateTransitionConditionGroup): boolean =>
  group.children.some((child) => {
    if (child.kind === "group") return hasInvalidCondition(child);
    return !VALUELESS_OPERATORS.has(child.operator) && (child.value === undefined || child.value === "");
  });

const formatError = (error: unknown, fallback: string): string => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const first = Object.values(error)[0];
  if (typeof first === "string") return first;
  if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  return formatError(first, fallback);
};

const parseConditionValue = (field: string, rawValue: string): unknown => {
  if (field === "actor.is_assignee" || field === "actor.is_creator" || field.startsWith("actor.member_property:"))
    return rawValue === "true";
  if (field === "actor.role" || field === "attachments" || field === "comments" || field === "estimate")
    return rawValue ? Number(rawValue) : "";
  return rawValue;
};

type TConditionTreeProps = {
  title: string;
  description: string;
  value: TStateTransitionConditionGroup;
  onChange: (tree: TStateTransitionConditionGroup) => void;
  states: IState[];
  properties: TProjectWorkItemProperty[];
  groups: TProjectUserGroup[];
};

function ConditionTreeEditor({ title, description, value, onChange, states, properties, groups }: TConditionTreeProps) {
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
          ? { ...node, children: [...node.children, { ...EMPTY_TREE(), children: [NEW_CONDITION()] }] }
          : node
      )
    );

  const changeConditionField = (conditionId: string, field: string) =>
    onChange(
      updateNode(value, conditionId, (node) => {
        if (node.kind !== "condition") return node;
        return {
          ...node,
          field,
          ...conditionDefaultsForField(field, groups),
        };
      })
    );

  const conditionValue = (condition: TStateTransitionCondition) => {
    if (VALUELESS_OPERATORS.has(condition.operator)) return null;
    const updateValue = (nextValue: unknown) =>
      onChange(
        updateNode(value, condition.id!, (node) => (node.kind === "condition" ? { ...node, value: nextValue } : node))
      );
    const isGroupField =
      condition.field.endsWith(".group") ||
      condition.field.includes(".group_any") ||
      condition.field.includes(".group_all");

    if (isGroupField)
      return (
        <select
          className="h-9 min-w-44 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? "")}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value="" disabled>
            {t("project_settings.state_transitions.editor.select_value")}
          </option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
              {group.archived_at ? ` (${t("project_settings.state_transitions.editor.archived_group")})` : ""}
            </option>
          ))}
        </select>
      );

    if (
      condition.field === "actor.is_assignee" ||
      condition.field === "actor.is_creator" ||
      condition.field.startsWith("actor.member_property:")
    )
      return (
        <select
          className="h-9 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? true)}
          onChange={(event) => updateValue(event.target.value === "true")}
        >
          <option value="true">{t("project_settings.state_transitions.editor.yes")}</option>
          <option value="false">{t("project_settings.state_transitions.editor.no")}</option>
        </select>
      );

    if (condition.field === "actor.role")
      return (
        <select
          className="h-9 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? 15)}
          onChange={(event) => updateValue(Number(event.target.value))}
        >
          <option value="5">{t("project_settings.state_transitions.editor.guest")}</option>
          <option value="15">{t("project_settings.state_transitions.editor.member")}</option>
          <option value="20">{t("project_settings.state_transitions.editor.project_admin")}</option>
        </select>
      );

    if (condition.field === "state")
      return (
        <select
          className="h-9 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? "")}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value="" disabled>
            {t("project_settings.state_transitions.editor.select_value")}
          </option>
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
      customProperty?.select_source === "MANUAL" &&
      (customProperty.property_type === "SINGLE_SELECT" || customProperty.property_type === "MULTI_SELECT")
    )
      return (
        <select
          className="h-9 min-w-40 rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
          value={String(condition.value ?? "")}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value="" disabled>
            {t("project_settings.state_transitions.editor.select_value")}
          </option>
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
        className="min-w-40"
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
        onChange={(event) => updateValue(parseConditionValue(condition.field, event.target.value))}
      />
    );
  };

  const renderNode = (node: TStateTransitionConditionNode, depth: number) => {
    if (node.kind === "condition") {
      const valueEditor = conditionValue(node);
      return (
        <div key={node.id} className="rounded-lg border border-subtle bg-surface-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 min-w-36 flex-[1_1_180px] rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
              value={node.field}
              onChange={(event) => changeConditionField(node.id!, event.target.value)}
            >
              {fieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-32 flex-[1_1_150px] rounded border border-subtle bg-surface-1 px-2 text-12 text-primary"
              value={node.operator}
              onChange={(event) =>
                onChange(
                  updateNode(value, node.id!, (current) =>
                    current.kind === "condition"
                      ? (() => {
                          const operator = event.target.value as TStateTransitionConditionOperator;
                          const defaultValue = conditionDefaultsForField(current.field, groups).value;
                          return {
                            ...current,
                            operator,
                            value: VALUELESS_OPERATORS.has(operator) ? undefined : (current.value ?? defaultValue),
                          };
                        })()
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
            {valueEditor && <div className="min-w-36 flex-[1_1_160px]">{valueEditor}</div>}
            <button
              type="button"
              className="ml-auto grid size-8 shrink-0 place-items-center rounded text-tertiary hover:bg-danger-subtle hover:text-danger-primary"
              onClick={() => onChange(removeNode(value, node.id!))}
              aria-label={t("project_settings.state_transitions.editor.remove_condition")}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <details className="mt-2 text-11 text-secondary">
            <summary className="w-fit cursor-pointer select-none hover:text-primary">
              {t("project_settings.state_transitions.editor.failure_message")}
            </summary>
            <Input
              className="mt-2"
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
          </details>
        </div>
      );
    }

    return (
      <div key={node.id} className={depth ? "ml-3 space-y-3 border-l border-accent-subtle pl-4" : "space-y-3"}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-11 font-semibold text-secondary">
            {depth
              ? t("project_settings.state_transitions.editor.nested_group")
              : t("project_settings.state_transitions.editor.condition_logic")}
          </span>
          <select
            className="h-8 rounded border border-subtle bg-surface-1 px-2 text-11 font-medium text-primary"
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
        {node.children.length ? (
          node.children.map((child) => renderNode(child, depth + 1))
        ) : (
          <div className="rounded-lg border border-dashed border-subtle px-4 py-6 text-center text-12 text-tertiary">
            {t("project_settings.state_transitions.editor.no_conditions")}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
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

  return (
    <section>
      <h2 className="text-16 font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-12 text-tertiary">{description}</p>
      <div className="mt-5">{renderNode(value, 0)}</div>
    </section>
  );
}

export function StateTransitionRuleEditor({
  workspaceSlug,
  projectId,
  states,
  properties,
  groups,
  rule,
  onCancel,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const [activeSection, setActiveSection] = useState<TEditorSection>("transition");
  const [isSaving, setIsSaving] = useState(false);
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

  const counts = {
    allow: countConditions(payload.allow_conditions),
    deny: countConditions(payload.deny_conditions),
    validation: countConditions(payload.validation_conditions),
    exceptions: Number(payload.project_admin_bypass) + Number(payload.system_bypass),
  };
  const sourceLabel =
    payload.source_type === "EXACT"
      ? states.find((state) => state.id === payload.source_state)?.name
      : t(
          payload.source_type === "CREATE"
            ? "project_settings.state_transitions.create"
            : "project_settings.state_transitions.any"
        );
  const targetLabel = states.find((state) => state.id === payload.target_state)?.name;

  const sections: Array<{ id: TEditorSection; title: string; description: string; count?: number }> = [
    {
      id: "transition",
      title: t("project_settings.state_transitions.editor.step_transition"),
      description: t("project_settings.state_transitions.editor.step_transition_help"),
    },
    {
      id: "allow",
      title: t("project_settings.state_transitions.editor.step_allow"),
      description: t("project_settings.state_transitions.editor.step_allow_help"),
      count: counts.allow,
    },
    {
      id: "deny",
      title: t("project_settings.state_transitions.editor.step_deny"),
      description: t("project_settings.state_transitions.editor.step_deny_help"),
      count: counts.deny,
    },
    {
      id: "validation",
      title: t("project_settings.state_transitions.editor.step_validation"),
      description: t("project_settings.state_transitions.editor.step_validation_help"),
      count: counts.validation,
    },
    {
      id: "exceptions",
      title: t("project_settings.state_transitions.editor.step_exceptions"),
      description: t("project_settings.state_transitions.editor.step_exceptions_help"),
      count: counts.exceptions,
    },
  ];

  const isValid = () => {
    const validTransition = Boolean(payload.target_state && (payload.source_type !== "EXACT" || payload.source_state));
    return (
      validTransition &&
      !hasInvalidCondition(payload.allow_conditions) &&
      !hasInvalidCondition(payload.deny_conditions) &&
      !hasInvalidCondition(payload.validation_conditions)
    );
  };

  const checkConfiguration = () => {
    const valid = isValid();
    setToast({
      type: valid ? TOAST_TYPE.SUCCESS : TOAST_TYPE.ERROR,
      title: t(valid ? "toast.success" : "toast.error"),
      message: t(
        valid
          ? "project_settings.state_transitions.editor.configuration_valid"
          : "project_settings.state_transitions.editor.configuration_invalid"
      ),
    });
    return valid;
  };

  const save = async () => {
    if (!checkConfiguration()) return;
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

  const active = sections.find((section) => section.id === activeSection)!;

  return (
    <div className="pb-12">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-surface-1/95 px-1 py-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded text-secondary hover:bg-layer-1 hover:text-primary"
            onClick={onCancel}
            aria-label={t("project_settings.state_transitions.editor.back_to_rules")}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-20 font-semibold text-primary">
              {t(
                rule
                  ? "project_settings.state_transitions.editor.edit_rule_title"
                  : "project_settings.state_transitions.editor.new_rule_title"
              )}
            </h1>
            <p className="flex flex-wrap items-center gap-1 text-11 text-tertiary">
              <span className="font-medium text-secondary">{sourceLabel}</span>
              <span>→</span>
              <span className="font-medium text-secondary">{targetLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{t("project_settings.state_transitions.editor.editor_help")}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="neutral-primary" onClick={checkConfiguration} disabled={isSaving}>
            {t("project_settings.state_transitions.editor.check_rule")}
          </Button>
          <Button onClick={save} loading={isSaving}>
            {t("project_settings.state_transitions.save")}
          </Button>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-subtle bg-surface-2 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-11 font-medium text-secondary">
              {t("project_settings.state_transitions.editor.transition_type")}
              <select
                className="h-10 w-full rounded border border-subtle bg-surface-1 px-3 text-13 text-primary"
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
                className="h-10 w-full rounded border border-subtle bg-surface-1 px-3 text-13 text-primary disabled:text-tertiary"
                value={payload.source_state ?? ""}
                disabled={payload.source_type !== "EXACT"}
                onChange={(event) => setPayload((current) => ({ ...current, source_state: event.target.value }))}
              >
                {payload.source_type !== "EXACT" && <option value="">{sourceLabel}</option>}
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ChevronRight className="mx-auto hidden size-5 text-tertiary md:block" />
          <label className="space-y-1 text-11 font-medium text-secondary">
            {t("project_settings.state_transitions.target")}
            <select
              className="h-10 w-full rounded border border-subtle bg-surface-1 px-3 text-13 text-primary"
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
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        <nav className="h-fit rounded-xl border border-subtle bg-surface-1 p-2">
          {sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${activeSection === section.id ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-layer-1"}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-10 font-semibold ${activeSection === section.id ? "border-accent-primary bg-accent-primary text-on-color" : "border-subtle"}`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-12 font-semibold">
                  <span>{section.title}</span>
                  {section.count !== undefined && section.count > 0 && (
                    <span className="rounded-full bg-layer-1 px-2 py-0.5 text-10 text-secondary">{section.count}</span>
                  )}
                </span>
                <span className="mt-0.5 block text-10 leading-4 text-tertiary">{section.description}</span>
              </span>
            </button>
          ))}
        </nav>

        <main className="min-h-96 rounded-xl border border-subtle bg-surface-1 p-5">
          {activeSection === "transition" && (
            <section>
              <h2 className="text-16 font-semibold text-primary">{active.title}</h2>
              <p className="mt-1 text-12 text-tertiary">{active.description}</p>
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-subtle bg-surface-2 px-5 py-12 text-center">
                <div className="grid size-11 place-items-center rounded-full bg-accent-subtle text-accent-primary">
                  <ListChecks className="size-5" />
                </div>
                <div className="mt-3 text-14 font-semibold text-primary">
                  {sourceLabel} <span className="px-2 text-tertiary">→</span> {targetLabel}
                </div>
                <p className="mt-2 max-w-md text-12 text-tertiary">
                  {t("project_settings.state_transitions.editor.transition_ready_help")}
                </p>
              </div>
            </section>
          )}
          {activeSection === "allow" && (
            <ConditionTreeEditor
              title={active.title}
              description={active.description}
              value={payload.allow_conditions}
              onChange={(allow_conditions) => setPayload((current) => ({ ...current, allow_conditions }))}
              states={states}
              properties={properties}
              groups={groups}
            />
          )}
          {activeSection === "deny" && (
            <ConditionTreeEditor
              title={active.title}
              description={active.description}
              value={payload.deny_conditions}
              onChange={(deny_conditions) => setPayload((current) => ({ ...current, deny_conditions }))}
              states={states}
              properties={properties}
              groups={groups}
            />
          )}
          {activeSection === "validation" && (
            <ConditionTreeEditor
              title={active.title}
              description={active.description}
              value={payload.validation_conditions}
              onChange={(validation_conditions) => setPayload((current) => ({ ...current, validation_conditions }))}
              states={states}
              properties={properties}
              groups={groups}
            />
          )}
          {activeSection === "exceptions" && (
            <section>
              <h2 className="text-16 font-semibold text-primary">{active.title}</h2>
              <p className="mt-1 text-12 text-tertiary">{active.description}</p>
              <div className="mt-5 divide-y divide-subtle rounded-xl border border-subtle">
                <div className="flex items-center justify-between gap-5 p-4">
                  <span>
                    <span className="block text-13 font-medium text-primary">
                      {t("project_settings.state_transitions.admin_bypass")}
                    </span>
                    <span className="mt-1 block text-11 text-tertiary">
                      {t("project_settings.state_transitions.editor.admin_bypass_help")}
                    </span>
                  </span>
                  <ToggleSwitch
                    value={payload.project_admin_bypass}
                    onChange={(project_admin_bypass) => setPayload((current) => ({ ...current, project_admin_bypass }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-5 p-4">
                  <span>
                    <span className="block text-13 font-medium text-primary">
                      {t("project_settings.state_transitions.system_bypass")}
                    </span>
                    <span className="mt-1 block text-11 text-tertiary">
                      {t("project_settings.state_transitions.editor.system_bypass_help")}
                    </span>
                  </span>
                  <ToggleSwitch
                    value={payload.system_bypass}
                    onChange={(system_bypass) => setPayload((current) => ({ ...current, system_bypass }))}
                  />
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="h-fit rounded-xl border border-subtle bg-surface-2 p-4 lg:col-start-2 xl:col-start-auto">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent-primary" />
            <h2 className="text-13 font-semibold text-primary">
              {t("project_settings.state_transitions.editor.summary_title")}
            </h2>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-1 p-3 text-12 font-medium text-primary">
            <span className="truncate">{sourceLabel}</span>
            <ChevronRight className="size-4 shrink-0 text-tertiary" />
            <span className="truncate">{targetLabel}</span>
          </div>
          <div className="mt-4 space-y-3">
            {(["allow", "deny", "validation"] as const).map((key) => {
              const count = counts[key];
              return (
                <div key={key} className="flex items-start gap-2 text-11">
                  <span className={`mt-0.5 ${count ? "text-success-primary" : "text-tertiary"}`}>
                    {count ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
                  </span>
                  <span className="text-secondary">
                    {t(`project_settings.state_transitions.editor.summary_${key}`, { count })}
                  </span>
                </div>
              );
            })}
            <div className="flex items-start gap-2 text-11">
              <span className={`mt-0.5 ${counts.exceptions ? "text-success-primary" : "text-tertiary"}`}>
                {counts.exceptions ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
              </span>
              <span className="text-secondary">
                {t("project_settings.state_transitions.editor.summary_exceptions", { count: counts.exceptions })}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-subtle pt-4">
        <Button variant="neutral-primary" onClick={onCancel} disabled={isSaving}>
          {t("project_settings.state_transitions.cancel")}
        </Button>
        <Button onClick={save} loading={isSaving}>
          {t("project_settings.state_transitions.save")}
        </Button>
      </div>
    </div>
  );
}
