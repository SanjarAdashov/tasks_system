/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TStateTransitionSourceType = "EXACT" | "ANY" | "CREATE";
export type TStateTransitionGroupOperator = "AND" | "OR";
export type TStateTransitionConditionOperator =
  | "IS_SET"
  | "IS_NOT_SET"
  | "EQ"
  | "NEQ"
  | "BEFORE"
  | "AFTER"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "ALL_COMPLETED"
  | "HAS_INCOMPLETE";

export type TStateTransitionCondition = {
  id?: string;
  kind: "condition";
  field: string;
  operator: TStateTransitionConditionOperator;
  value?: unknown;
  message?: string;
};

export type TStateTransitionConditionGroup = {
  id?: string;
  kind: "group";
  operator: TStateTransitionGroupOperator;
  children: TStateTransitionConditionNode[];
};

export type TStateTransitionConditionNode = TStateTransitionCondition | TStateTransitionConditionGroup;

export type TProjectStateTransitionSettings = {
  id: string;
  project: string;
  workspace: string;
  strict_mode: boolean;
  created_at: string;
  updated_at: string;
};

export type TProjectStateTransitionRule = {
  id: string;
  project: string;
  workspace: string;
  source_type: TStateTransitionSourceType;
  source_state: string | null;
  target_state: string;
  allow_conditions: TStateTransitionConditionGroup;
  deny_conditions: TStateTransitionConditionGroup;
  validation_conditions: TStateTransitionConditionGroup;
  project_admin_bypass: boolean;
  system_bypass: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TProjectStateTransitionRulePayload = Omit<
  TProjectStateTransitionRule,
  "id" | "project" | "workspace" | "archived_at" | "created_at" | "updated_at"
>;

export type TStateTransitionEvaluation = {
  allowed: boolean;
  code: string;
  reasons: string[];
  required_fields: string[];
  applied_rule_ids: string[];
};

export type TAvailableStateTransition = TStateTransitionEvaluation & {
  state_id: string;
};

export type TStateTransitionAuditLog = {
  id: string;
  action: "CONFIGURATION_CHANGED" | "TRANSITION_DENIED";
  issue: string | null;
  rule: string | null;
  source_state: string | null;
  target_state: string | null;
  details: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
};
