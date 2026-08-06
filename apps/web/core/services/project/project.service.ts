/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  GithubRepositoriesResponse,
  IProjectUserPropertiesResponse,
  ISearchIssueResponse,
  TProjectAnalyticsCount,
  TProjectAnalyticsCountParams,
  TProjectIssuesSearchParams,
  TProjectWorkItemFieldConfiguration,
  TProjectWorkItemProperty,
  TProjectWorkItemPropertyPayload,
  TProjectStateTransitionRule,
  TProjectStateTransitionRulePayload,
  TProjectStateTransitionSettings,
  TStateTransitionAuditLog,
  TStateTransitionEvaluation,
  TAvailableStateTransition,
  TProject,
  TPartialProject,
} from "@plane/types";
// helpers
// plane web types
// services
import { APIService } from "@/services/api.service";

export class ProjectService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async createProject(workspaceSlug: string, data: Partial<TProject>): Promise<TProject> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async checkProjectIdentifierAvailability(workspaceSlug: string, data: string): Promise<any> {
    return this.get(`/api/workspaces/${workspaceSlug}/project-identifiers`, {
      params: {
        name: data,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectsLite(workspaceSlug: string): Promise<TPartialProject[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjects(workspaceSlug: string): Promise<TProject[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/details/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProject(workspaceSlug: string, projectId: string): Promise<TProject> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async getProjectAnalyticsCount(
    workspaceSlug: string,
    params?: TProjectAnalyticsCountParams
  ): Promise<TProjectAnalyticsCount[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/project-stats/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateProject(workspaceSlug: string, projectId: string, data: Partial<TProject>): Promise<TProject> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteProject(workspaceSlug: string, projectId: string): Promise<any> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // User Properties
  async getProjectUserProperties(workspaceSlug: string, projectId: string): Promise<IProjectUserPropertiesResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-properties/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateProjectUserProperties(
    workspaceSlug: string,
    projectId: string,
    data: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-properties/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getWorkItemFieldConfiguration(
    workspaceSlug: string,
    projectId: string
  ): Promise<TProjectWorkItemFieldConfiguration> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/configuration/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateWorkItemFieldConfiguration(
    workspaceSlug: string,
    projectId: string,
    data: Pick<TProjectWorkItemFieldConfiguration, "built_in_fields">
  ): Promise<TProjectWorkItemFieldConfiguration> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/configuration/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getWorkItemProperties(workspaceSlug: string, projectId: string): Promise<TProjectWorkItemProperty[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/properties/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createWorkItemProperty(
    workspaceSlug: string,
    projectId: string,
    data: TProjectWorkItemPropertyPayload
  ): Promise<TProjectWorkItemProperty> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/properties/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateWorkItemProperty(
    workspaceSlug: string,
    projectId: string,
    propertyId: string,
    data: Partial<TProjectWorkItemPropertyPayload>
  ): Promise<TProjectWorkItemProperty> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/properties/${propertyId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async archiveWorkItemProperty(workspaceSlug: string, projectId: string, propertyId: string): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/work-item-fields/properties/${propertyId}/`
    )
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getStateTransitionSettings(workspaceSlug: string, projectId: string): Promise<TProjectStateTransitionSettings> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/settings/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateStateTransitionSettings(
    workspaceSlug: string,
    projectId: string,
    data: Pick<TProjectStateTransitionSettings, "strict_mode">
  ): Promise<TProjectStateTransitionSettings> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/settings/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getStateTransitionRules(workspaceSlug: string, projectId: string): Promise<TProjectStateTransitionRule[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/rules/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createStateTransitionRule(
    workspaceSlug: string,
    projectId: string,
    data: TProjectStateTransitionRulePayload
  ): Promise<TProjectStateTransitionRule> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/rules/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateStateTransitionRule(
    workspaceSlug: string,
    projectId: string,
    ruleId: string,
    data: Partial<TProjectStateTransitionRulePayload>
  ): Promise<TProjectStateTransitionRule> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/rules/${ruleId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async archiveStateTransitionRule(workspaceSlug: string, projectId: string, ruleId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/rules/${ruleId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getStateTransitionAuditLogs(workspaceSlug: string, projectId: string): Promise<TStateTransitionAuditLog[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/audit-logs/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async previewStateTransition(
    workspaceSlug: string,
    projectId: string,
    data: {
      actor_id?: string;
      issue_id?: string;
      target_state_id: string;
      is_creation?: boolean;
      proposed_data?: Record<string, unknown>;
    }
  ): Promise<TStateTransitionEvaluation> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/preview/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getAvailableStateTransitions(
    workspaceSlug: string,
    projectId: string,
    data: {
      issue_id?: string;
      is_creation?: boolean;
      proposed_data?: Record<string, unknown>;
    }
  ): Promise<TAvailableStateTransition[]> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/state-transitions/available/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getGithubRepositories(url: string): Promise<GithubRepositoriesResponse> {
    return this.request({
      method: "get",
      url,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async syncGithubRepository(
    workspaceSlug: string,
    projectId: string,
    workspaceIntegrationId: string,
    data: {
      name: string;
      owner: string;
      repository_id: string;
      url: string;
    }
  ): Promise<any> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/workspace-integrations/${workspaceIntegrationId}/github-repository-sync/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getProjectGithubRepository(workspaceSlug: string, projectId: string, integrationId: string): Promise<any> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/workspace-integrations/${integrationId}/github-repository-sync/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getUserProjectFavorites(workspaceSlug: string): Promise<any[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/user-favorite-projects/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addProjectToFavorites(workspaceSlug: string, project: string): Promise<any> {
    return this.post(`/api/workspaces/${workspaceSlug}/user-favorite-projects/`, { project })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeProjectFromFavorites(workspaceSlug: string, projectId: string): Promise<any> {
    return this.delete(`/api/workspaces/${workspaceSlug}/user-favorite-projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async projectIssuesSearch(
    workspaceSlug: string,
    projectId: string,
    params: TProjectIssuesSearchParams
  ): Promise<ISearchIssueResponse[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/search-issues/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
