import type { IUserLite } from "./users";
import type { TProjectUserGroup } from "./user-group";

export type TProjectAnnouncementType = "standard" | "important";
export type TProjectAnnouncementDeliveryStatus = "pending" | "sent" | "skipped" | "failed";

export type TProjectAnnouncementAttachment = {
  id: string;
  name: string;
  content_type: string;
  size: number;
  download_url: string;
  inline_url: string;
  created_at: string;
};

export type TProjectAnnouncementStatistics = {
  total: number;
  read: number;
  unread: number;
  modal_dismissals: number;
  email: Record<TProjectAnnouncementDeliveryStatus, number>;
  telegram: Record<TProjectAnnouncementDeliveryStatus, number>;
};

export type TProjectAnnouncementRecipientState = {
  read_at: string | null;
  modal_dismissed_at: string | null;
  modal_dismiss_count: number;
  notification_id: string | null;
};

export type TProjectAnnouncementRecipient = {
  id: string;
  user: string;
  user_details: IUserLite;
  read_at: string | null;
  modal_dismissed_at: string | null;
  modal_dismiss_count: number;
  email_status: TProjectAnnouncementDeliveryStatus;
  telegram_status: TProjectAnnouncementDeliveryStatus;
  email_error: string;
  telegram_error: string;
  created_at: string;
};

export type TProjectAnnouncement = {
  id: string;
  project: string;
  workspace: string;
  title: string;
  content_html: string;
  content_plain: string;
  announcement_type: TProjectAnnouncementType;
  recipient_selection: {
    all_members: boolean;
    user_ids: string[];
    group_ids: string[];
  };
  recipient_count: number;
  sent_at: string;
  created_by: string | null;
  created_by_details: IUserLite | null;
  attachments: TProjectAnnouncementAttachment[];
  statistics: TProjectAnnouncementStatistics | null;
  recipients?: TProjectAnnouncementRecipient[];
  recipient_state?: TProjectAnnouncementRecipientState | null;
};

export type TProjectAnnouncementOptions = {
  users: IUserLite[];
  groups: TProjectUserGroup[];
};

export type TCreateProjectAnnouncement = {
  title: string;
  content_html: string;
  announcement_type: TProjectAnnouncementType;
  all_members: boolean;
  user_ids: string[];
  group_ids: string[];
  attachments: File[];
};
