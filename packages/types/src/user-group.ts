export type TProjectUserGroupMember = {
  id: string;
  member_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  account_status: "active" | "inactive" | "blocked";
  project_member_active: boolean;
};

export type TProjectUserGroup = {
  id: string;
  name: string;
  description: string;
  archived_at: string | null;
  members: TProjectUserGroupMember[];
  created_at: string;
  updated_at: string;
};

export type TProjectUserGroupPayload = {
  name: string;
  description?: string;
  member_ids?: string[];
};
