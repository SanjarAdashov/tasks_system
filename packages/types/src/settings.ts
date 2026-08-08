/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// local imports
import type { EUserProjectRoles } from ".";
import type { EUserWorkspaceRoles } from "./workspace";

export type TProfileSettingsTabs = "general" | "preferences" | "notifications" | "security" | "api-tokens";

export type TWorkspaceSettingsTabs = "general" | "members" | "billing-and-plans" | "export" | "webhooks";
export type TWorkspaceSettingsItem = {
  key: TWorkspaceSettingsTabs;
  i18n_label: string;
  href: string;
  access: EUserWorkspaceRoles[];
  highlight: (pathname: string, baseUrl: string) => boolean;
};

export type TProjectSettingsTabs =
  | "general"
  | "members"
  | "user_groups"
  | "features_cycles"
  | "features_modules"
  | "features_views"
  | "features_pages"
  | "features_intake"
  | "states"
  | "state_order"
  | "state_transitions"
  | "attachments"
  | "labels"
  | "estimates"
  | "work_item_fields"
  | "automations";
export type TProjectSettingsItem = {
  key: TProjectSettingsTabs;
  i18n_label: string;
  href: string;
  access: EUserProjectRoles[];
  highlight: (pathname: string, baseUrl: string) => boolean;
};

export type TProjectAttachmentSettings = {
  id: string;
  project: string;
  workspace: string;
  image_max_size: number | null;
  video_max_size: number | null;
  audio_max_size: number | null;
  pdf_max_size: number | null;
  document_max_size: number | null;
  archive_max_size: number | null;
  other_max_size: number | null;
  created_at: string;
  updated_at: string;
};
