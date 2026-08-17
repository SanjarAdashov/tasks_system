/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IUserLite } from "../users";
import type { TProjectUserGroup } from "../user-group";
import type {
  TInstanceAIConfigurationKeys,
  TInstanceEmailConfigurationKeys,
  TInstanceImageConfigurationKeys,
  TInstanceAuthenticationKeys,
  TInstanceWorkspaceConfigurationKeys,
  TCoreLoginMediums,
} from "./";
import type { TExtendedLoginMediums } from "./auth-ee";

export interface IInstanceInfo {
  instance: IInstance;
  config: IInstanceConfig;
}

export interface IInstance {
  id: string;
  created_at: string;
  updated_at: string;
  instance_name: string | undefined;
  whitelist_emails: string | undefined;
  instance_id: string | undefined;
  license_key: string | undefined;
  current_version: string | undefined;
  latest_version: string | undefined;
  last_checked_at: string | undefined;
  namespace: string | undefined;
  is_telemetry_enabled: boolean;
  is_support_required: boolean;
  is_activated: boolean;
  is_setup_done: boolean;
  is_signup_screen_visited: boolean;
  user_count: number | undefined;
  is_verified: boolean;
  created_by: string | undefined;
  updated_by: string | undefined;
  workspaces_exist: boolean;
}

export interface IInstanceConfig {
  enable_signup: boolean;
  is_workspace_creation_disabled: boolean;
  is_google_enabled: boolean;
  is_github_enabled: boolean;
  is_gitlab_enabled: boolean;
  is_gitea_enabled: boolean;
  is_magic_login_enabled: boolean;
  is_email_password_enabled: boolean;
  github_app_name: string | undefined;
  slack_client_id: string | undefined;
  posthog_api_key: string | undefined;
  posthog_host: string | undefined;
  has_unsplash_configured: boolean;
  has_llm_configured: boolean;
  file_size_limit: number | undefined;
  is_smtp_configured: boolean;
  app_base_url: string | undefined;
  space_base_url: string | undefined;
  admin_base_url: string | undefined;
  is_self_managed: boolean;
  instance_changelog_url?: string;
  default_interface_theme?: string;
  default_glass_accent_color?: string;
  default_glass_background?: "gts-tasks" | "custom" | "none";
  default_glass_background_url?: string;
  default_glass_overlay_opacity?: number;
  default_glass_workspace_opacity?: number;
  default_glass_task_opacity?: number;
}

export interface IInstanceAdmin {
  created_at: string;
  created_by: string;
  id: string;
  instance: string;
  role: string;
  updated_at: string;
  updated_by: string;
  user: string;
  user_detail: IUserLite;
}

export type TInstanceUserStatus = "active" | "blocked" | "inactive";

export interface IInstanceUser {
  id: string;
  email: string;
  display_name: string;
  legacy_display_name?: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  date_joined: string;
  last_login_time: string | null;
  is_active: boolean;
  status: TInstanceUserStatus;
  is_instance_admin: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  blocked_by: IUserLite | null;
}

export interface IInstanceUserStats {
  total_users: number;
  active_users: number;
  blocked_users: number;
}

export interface IInstanceUserPagination {
  count: number;
  next_cursor: string;
  next_page_results: boolean;
  prev_cursor: string;
  prev_page_results: boolean;
  results: IInstanceUser[];
  total_pages: number;
  total_results: number;
  extra_stats: IInstanceUserStats;
}

export interface IInstanceUserAccessPayload {
  reason: string;
}

export interface ICreationQuotaValue {
  limit: number | null;
  used: number;
  remaining: number | null;
  is_unlimited: boolean;
  can_create: boolean;
}

export interface IProjectCreationQuota extends ICreationQuotaValue {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  membership_active: boolean;
}

export interface IUserCreationQuotaSnapshot {
  user_id: string;
  is_instance_admin: boolean;
  workspace: ICreationQuotaValue;
  projects: IProjectCreationQuota[];
}

export interface IInstanceProjectUserGroupContext {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    projects: Array<{ id: string; name: string; identifier: string }>;
  }>;
  groups: TProjectUserGroup[];
  eligible_members: IUserLite[];
}

export type TInstanceConfigurationKeys =
  | TInstanceAIConfigurationKeys
  | TInstanceEmailConfigurationKeys
  | TInstanceImageConfigurationKeys
  | TInstanceAuthenticationKeys
  | TInstanceWorkspaceConfigurationKeys
  | "DEFAULT_INTERFACE_THEME"
  | "DEFAULT_GLASS_ACCENT_COLOR"
  | "DEFAULT_GLASS_BACKGROUND"
  | "DEFAULT_GLASS_BACKGROUND_URL"
  | "DEFAULT_GLASS_OVERLAY_OPACITY"
  | "DEFAULT_GLASS_WORKSPACE_OPACITY"
  | "DEFAULT_GLASS_TASK_OPACITY";

export interface IInstanceThemeSettings {
  theme: string;
  glass_accent_color: string;
  glass_background: "gts-tasks" | "custom" | "none";
  glass_background_url: string;
  glass_overlay_opacity: number;
  glass_workspace_opacity: number;
  glass_task_opacity: number;
}

export interface IInstanceThemeApplyResponse {
  updated_count: number;
}

export interface IInstanceTelegramStatus {
  configured: boolean;
  enabled: boolean;
  bot_id: string | null;
  bot_username: string | null;
  webhook_url: string | null;
  connection_count: number;
  connections_invalidated?: boolean;
  proxy_configured: boolean;
  proxy_scheme: "http" | "https" | "socks5" | "socks5h" | null;
  api_endpoint_mode: "standard" | "custom";
  custom_api_endpoint_configured: boolean;
  api_endpoint_host: string;
  webhook: {
    url?: string;
    pending_update_count?: number;
    last_error_date?: number | null;
    last_error_message?: string | null;
    error?: string;
  } | null;
}

export interface IInstanceTelegramConnection {
  id: string;
  user_id: string;
  name: string;
  email: string;
  telegram_username: string;
  telegram_first_name: string;
  status: "connected" | "paused" | "error";
  connected_at: string;
  last_delivery_at: string | null;
  account_active: boolean;
}

export interface IInstanceTelegramConnectionPagination {
  count: number;
  next_cursor: string;
  next_page_results: boolean;
  prev_cursor: string;
  prev_page_results: boolean;
  results: IInstanceTelegramConnection[];
  total_pages: number;
  total_results: number;
}

export interface IInstanceConfiguration {
  id: string;
  created_at: string;
  updated_at: string;
  key: TInstanceConfigurationKeys;
  value: string;
  created_by: string | null;
  updated_by: string | null;
}

export type IFormattedInstanceConfiguration = {
  [key in TInstanceConfigurationKeys]: string;
};

export type TLoginMediums = TCoreLoginMediums | TExtendedLoginMediums;
