import { API_BASE_URL } from "@plane/constants";
import type { TCreateProjectAnnouncement, TProjectAnnouncement, TProjectAnnouncementOptions } from "@plane/types";
import { APIService } from "@/services/api.service";

export class ProjectAnnouncementService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string, projectId: string): Promise<TProjectAnnouncement[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/announcements/`).then(
      (response) => response.data
    );
  }

  async getOptions(workspaceSlug: string, projectId: string): Promise<TProjectAnnouncementOptions> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/announcements/`, {
      params: { options: true },
    }).then((response) => response.data);
  }

  async create(
    workspaceSlug: string,
    projectId: string,
    payload: TCreateProjectAnnouncement
  ): Promise<TProjectAnnouncement> {
    const form = new FormData();
    form.append("title", payload.title);
    form.append("content_html", payload.content_html);
    form.append("announcement_type", payload.announcement_type);
    form.append("all_members", String(payload.all_members));
    form.append("user_ids", JSON.stringify(payload.user_ids));
    form.append("group_ids", JSON.stringify(payload.group_ids));
    payload.attachments.forEach((file) => form.append("attachments", file));
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/announcements/`, form, {
      timeout: 0,
    }).then((response) => response.data);
  }

  async getAdminDetail(
    workspaceSlug: string,
    projectId: string,
    announcementId: string
  ): Promise<TProjectAnnouncement> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/announcements/${announcementId}/`).then(
      (response) => response.data
    );
  }

  async listImportant(workspaceSlug: string): Promise<TProjectAnnouncement[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/users/project-announcements/important/`).then(
      (response) => response.data
    );
  }

  async getDetail(workspaceSlug: string, announcementId: string): Promise<TProjectAnnouncement> {
    return this.get(`/api/workspaces/${workspaceSlug}/users/project-announcements/${announcementId}/`).then(
      (response) => response.data
    );
  }

  async dismiss(workspaceSlug: string, announcementId: string): Promise<void> {
    await this.post(`/api/workspaces/${workspaceSlug}/users/project-announcements/${announcementId}/dismiss/`);
  }
}

const projectAnnouncementService = new ProjectAnnouncementService();
export default projectAnnouncementService;
