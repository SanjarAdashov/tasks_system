/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type {
  IFormattedInstanceConfiguration,
  IInstance,
  IInstanceAdmin,
  IInstanceConfiguration,
  IInstanceInfo,
  TPage,
  IInstanceUser,
  IInstanceUserAccessPayload,
  IInstanceUserPagination,
  IUserCreationQuotaSnapshot,
  IInstanceProjectUserGroupContext,
  TProjectUserGroup,
  TProjectUserGroupPayload,
} from "@plane/types";
// api service
import { APIService } from "../api.service";

/**
 * Service class for managing instance-related operations
 * Handles retrieval of instance information and changelog
 * @extends {APIService}
 */
export class InstanceService extends APIService {
  /**
   * Creates an instance of InstanceService
   * Initializes the service with the base API URL
   */
  constructor() {
    super(API_BASE_URL);
  }

  /**
   * Retrieves information about the current instance
   * @returns {Promise<IInstanceInfo>} Promise resolving to instance information
   * @throws {Error} If the API request fails
   * @remarks This method uses the validateStatus: null option to bypass interceptors for unauthorized errors.
   */
  async info(): Promise<IInstanceInfo> {
    return this.get("/api/instances/", { validateStatus: null })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the changelog for the current instance
   * @returns {Promise<TPage>} Promise resolving to the changelog page data
   * @throws {Error} If the API request fails
   */
  async changelog(): Promise<TPage> {
    return this.get("/api/instances/changelog/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the list of instance admins
   * @returns {Promise<IInstanceAdmin[]>} Promise resolving to an array of instance admins
   * @throws {Error} If the API request fails
   * @remarks This method uses the validateStatus: null option to bypass interceptors for unauthorized errors.
   */
  async admins(): Promise<IInstanceAdmin[]> {
    return this.get("/api/instances/admins/", { validateStatus: null })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches users managed by the current instance administrator.
   */
  async users(search = "", cursor = ""): Promise<IInstanceUserPagination> {
    return this.get("/api/instances/users/", {
      params: {
        per_page: 100,
        search: search || undefined,
        cursor: cursor || undefined,
      },
    })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Blocks a user without changing workspace or project membership.
   */
  async blockUser(userId: string, data: IInstanceUserAccessPayload): Promise<IInstanceUser> {
    return this.post(`/api/instances/users/${userId}/block/`, data)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Restores sign-in access while preserving the user's existing role.
   */
  async unblockUser(userId: string, data: IInstanceUserAccessPayload): Promise<IInstanceUser> {
    return this.post(`/api/instances/users/${userId}/unblock/`, data)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async userCreationQuotas(userId: string): Promise<IUserCreationQuotaSnapshot> {
    return this.get(`/api/instances/users/${userId}/creation-quotas/`)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateUserCreationQuotas(
    userId: string,
    data: { workspace_limit?: number | null; project_quota?: { workspace_id: string; limit: number | null } }
  ): Promise<IUserCreationQuotaSnapshot> {
    return this.patch(`/api/instances/users/${userId}/creation-quotas/`, data)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async projectUserGroupContext(projectId?: string, includeArchived = true): Promise<IInstanceProjectUserGroupContext> {
    return this.get("/api/instances/project-user-groups/", {
      params: { project_id: projectId, include_archived: includeArchived },
    })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createProjectUserGroup(
    workspaceSlug: string,
    projectId: string,
    data: TProjectUserGroupPayload
  ): Promise<TProjectUserGroup> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/`, data).then(
      (response) => response.data
    );
  }

  async updateProjectUserGroup(
    workspaceSlug: string,
    projectId: string,
    groupId: string,
    data: Partial<TProjectUserGroupPayload>
  ): Promise<TProjectUserGroup> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/${groupId}/`, data).then(
      (response) => response.data
    );
  }

  async updateProjectUserGroupMembers(
    workspaceSlug: string,
    projectId: string,
    groupId: string,
    data: { add_member_ids?: string[]; remove_member_ids?: string[] }
  ): Promise<TProjectUserGroup> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/${groupId}/members/`,
      data
    ).then((response) => response.data);
  }

  async archiveProjectUserGroup(workspaceSlug: string, projectId: string, groupId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/${groupId}/`).then(
      () => undefined
    );
  }

  async restoreProjectUserGroup(workspaceSlug: string, projectId: string, groupId: string): Promise<TProjectUserGroup> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/${groupId}/restore/`).then(
      (response) => response.data
    );
  }

  async deleteProjectUserGroup(workspaceSlug: string, projectId: string, groupId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/user-groups/${groupId}/`, undefined, {
      params: { permanent: true, include_archived: true },
    }).then(() => undefined);
  }

  /**
   * Updates the instance information
   * @param {Partial<IInstance>} data Data to update the instance with
   * @returns {Promise<IInstance>} Promise resolving to the updated instance information
   * @throws {Error} If the API request fails
   */
  async update(data: Partial<IInstance>): Promise<IInstance> {
    return this.patch("/api/instances/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the list of instance configurations
   * @returns {Promise<IInstanceConfiguration[]>} Promise resolving to an array of instance configurations
   * @throws {Error} If the API request fails
   */
  async configurations(): Promise<IInstanceConfiguration[]> {
    return this.get("/api/instances/configurations/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Updates the instance configurations
   * @param {Partial<IFormattedInstanceConfiguration>} data Data to update the instance configurations with
   * @returns {Promise<IInstanceConfiguration[]>} The updated instance configurations
   * @throws {Error} If the API request fails
   */
  async updateConfigurations(data: Partial<IFormattedInstanceConfiguration>): Promise<IInstanceConfiguration[]> {
    return this.patch("/api/instances/configurations/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Sends a test email to the specified receiver to test SMTP configuration
   * @param {string} receiverEmail Email address to send the test email to
   * @returns {Promise<void>} Promise resolving to void
   * @throws {Error} If the API request fails
   */
  async sendTestEmail(receiverEmail: string): Promise<void> {
    return this.post("/api/instances/email-credentials-check/", {
      receiver_email: receiverEmail,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Disables the email configuration
   * @returns {Promise<void>} Promise resolving to void
   * @throws {Error} If the API request fails
   */
  async disableEmail(): Promise<void> {
    return this.delete("/api/instances/configurations/disable-email-feature/")
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
