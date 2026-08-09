/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TIntakeAssetUpload,
  TIntakeForm,
  TIntakeFormPayload,
  TPublicIntakeForm,
  TPublicIntakeSubmission,
  TPublicIntakeTracking,
} from "@plane/types";
import { APIService } from "../api.service";

export default class IntakeService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  async getForms(workspaceSlug: string, projectId: string): Promise<TIntakeForm[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/`).then(
      (response) => response.data
    );
  }

  async createForm(workspaceSlug: string, projectId: string, data: TIntakeFormPayload): Promise<TIntakeForm> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/`, data).then(
      (response) => response.data
    );
  }

  async updateForm(
    workspaceSlug: string,
    projectId: string,
    formId: string,
    data: Partial<TIntakeFormPayload>
  ): Promise<TIntakeForm> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/${formId}/`, data).then(
      (response) => response.data
    );
  }

  async deleteForm(workspaceSlug: string, projectId: string, formId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/${formId}/`).then(
      () => undefined
    );
  }

  async archiveForm(workspaceSlug: string, projectId: string, formId: string): Promise<TIntakeForm> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/${formId}/archive/`).then(
      (response) => response.data
    );
  }

  async restoreForm(workspaceSlug: string, projectId: string, formId: string): Promise<TIntakeForm> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/${formId}/restore/`).then(
      (response) => response.data
    );
  }

  async suggestSlugs(workspaceSlug: string, projectId: string, value: string): Promise<string[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/slug-suggestions/`, {
      params: { value },
    }).then((response) => response.data.suggestions);
  }

  async generateAccessCode(workspaceSlug: string, projectId: string): Promise<string> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-forms/access-code/`).then(
      (response) => response.data.access_code
    );
  }

  async getPublicForm(slug: string, accessCode?: string): Promise<TPublicIntakeForm> {
    return this.get(`/api/public/support/forms/${slug}/`, {}, {
      headers: accessCode ? { "X-Intake-Code": accessCode } : undefined,
    }).then((response) => response.data);
  }

  async createPublicSubmission(
    slug: string,
    data: { tracking_token: string; locale: string; values: Record<string, unknown>; asset_ids: string[] },
    accessCode?: string,
    idempotencyKey?: string
  ): Promise<TPublicIntakeSubmission> {
    return this.post(`/api/public/support/forms/${slug}/`, data, {
      headers: {
        ...(accessCode ? { "X-Intake-Code": accessCode } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      timeout: 0,
    }).then((response) => response.data);
  }

  async preparePublicAsset(
    slug: string,
    data: { tracking_token: string; name: string; type: string; size: number },
    accessCode?: string
  ): Promise<TIntakeAssetUpload> {
    return this.post(`/api/public/support/forms/${slug}/assets/`, data, {
      headers: accessCode ? { "X-Intake-Code": accessCode } : undefined,
    }).then((response) => response.data);
  }

  async completePublicAsset(slug: string, assetId: string, trackingToken: string, accessCode?: string): Promise<void> {
    return this.patch(
      `/api/public/support/forms/${slug}/assets/${assetId}/`,
      { tracking_token: trackingToken },
      { headers: accessCode ? { "X-Intake-Code": accessCode } : undefined }
    ).then(() => undefined);
  }

  async getPublicTracking(trackingToken: string): Promise<TPublicIntakeTracking> {
    return this.get(`/api/public/support/status/${trackingToken}/`).then((response) => response.data);
  }

  async commentOnPublicTracking(
    trackingToken: string,
    data: { comment_html: string; asset_ids: string[] }
  ): Promise<TPublicIntakeTracking> {
    return this.post(`/api/public/support/status/${trackingToken}/`, data).then((response) => response.data);
  }

  async prepareTrackingAsset(
    trackingToken: string,
    data: { name: string; type: string; size: number }
  ): Promise<TIntakeAssetUpload> {
    return this.post(`/api/public/support/status/${trackingToken}/assets/`, data).then((response) => response.data);
  }

  async completeTrackingAsset(trackingToken: string, assetId: string): Promise<void> {
    return this.patch(`/api/public/support/status/${trackingToken}/assets/${assetId}/`).then(() => undefined);
  }
}

export { IntakeService };
