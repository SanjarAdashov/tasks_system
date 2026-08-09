/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type TIntakeFormAccessType = "PUBLIC" | "CODE" | "AUTHENTICATED";
export type TIntakeFormFieldSource = "FORM" | "SYSTEM" | "CUSTOM";
export type TIntakeFormConditionAction = "SHOW" | "HIDE";
export type TIntakeFormConditionMatch = "ALL" | "ANY";

export type TIntakeFormField = {
  id: string;
  source: TIntakeFormFieldSource;
  key: string;
  visible: boolean;
  required: boolean;
  sort_order: number;
  property_id?: string;
  name?: string;
  description?: string;
  property_type?: string;
  options?: { id: string; name: string }[];
};

export type TIntakeFormConditionRule = {
  field_id: string;
  operator: "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "IS_EMPTY" | "IS_NOT_EMPTY";
  value?: unknown;
};

export type TIntakeFormCondition = {
  target_field_id: string;
  action: TIntakeFormConditionAction;
  match: TIntakeFormConditionMatch;
  rules: TIntakeFormConditionRule[];
};

export type TIntakeFormBranding = {
  accent_color?: string;
  header_image?: string;
  logo_url?: string;
  success_message?: string;
};

export type TIntakeForm = {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_enabled: boolean;
  archived_at: string | null;
  access_type: TIntakeFormAccessType;
  has_access_code: boolean;
  public_path: string;
  target_state: string;
  reviewer_group: string;
  field_schema: TIntakeFormField[];
  hidden_values: Record<string, unknown>;
  conditions: TIntakeFormCondition[];
  branding: TIntakeFormBranding;
  translations: Record<string, Record<string, string>>;
  public_status_mapping: Record<string, unknown>;
  title_template: string;
  email_notifications_enabled: boolean;
  max_attachments: number;
  submission_count: number;
  created_at: string;
  updated_at: string;
};

export type TIntakeFormPayload = Omit<
  TIntakeForm,
  "id" | "archived_at" | "has_access_code" | "public_path" | "submission_count" | "created_at" | "updated_at"
> & { access_code?: string };

export type TPublicIntakeForm = {
  id: string;
  name: string;
  description: string;
  slug: string;
  access_type: TIntakeFormAccessType;
  project: {
    name: string;
    identifier: string;
    emoji?: string;
    icon_prop?: Record<string, unknown>;
    cover_image?: string;
  };
  fields: TIntakeFormField[];
  conditions: TIntakeFormCondition[];
  branding: TIntakeFormBranding;
  translations: Record<string, Record<string, string>>;
  max_attachments: number;
  email_notifications_enabled: boolean;
  supported_locales: string[];
  tracking_token: string;
};

export type TPublicIntakeSubmission = {
  reference: string;
  tracking_token: string;
  tracking_path: string;
};

export type TPublicIntakeTracking = {
  reference: string;
  form_slug: string;
  success_message?: string;
  public_status: "RECEIVED" | "UNDER_REVIEW" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
  title: string;
  created_at: string;
  updated_at: string;
  comments: {
    id: string;
    comment_html: string;
    created_at: string;
    edited_at?: string;
    author: string;
  }[];
  events: {
    id: string;
    event_type: string;
    public_status?: string;
    message?: string;
    created_at: string;
  }[];
  attachments: { id: string; name: string; type: string; size: number }[];
};

export type TIntakeAssetUpload = {
  asset_id: string;
  upload_data: { url: string; fields: Record<string, string> };
};
