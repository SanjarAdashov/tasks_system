import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Bell,
  CheckCheck,
  FileText,
  Eye,
  Mail,
  Megaphone,
  MessageSquareWarning,
  Paperclip,
  Plus,
  Send,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IUserLite,
  TCreateProjectAnnouncement,
  TProjectAnnouncement,
  TProjectAnnouncementOptions,
  TProjectAnnouncementType,
} from "@plane/types";
import { Avatar, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn, getFileURL, getUserFullName } from "@plane/utils";
import { LiteTextEditor } from "@/components/editor/lite-text";
import { useWorkspace } from "@/hooks/store/use-workspace";
import projectAnnouncementService from "@/services/project-announcement.service";

type Props = { workspaceSlug: string; projectId: string };

const emptyPayload: TCreateProjectAnnouncement = {
  title: "",
  content_html: "",
  announcement_type: "standard",
  all_members: false,
  user_ids: [],
  group_ids: [],
  attachments: [],
};

const inputClass =
  "h-10 w-full rounded-md border border-subtle bg-surface-1 px-3 text-13 text-primary outline-none transition-colors placeholder:text-placeholder focus:border-accent-primary";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const errorMessage = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: Record<string, string | string[]> } })?.response?.data;
  if (!data) return fallback;
  const first = Object.values(data)[0];
  return Array.isArray(first) ? first[0] : typeof first === "string" ? first : fallback;
};

function DeliveryCount({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 text-caption-sm-regular text-secondary">
      <Icon className="size-3.5" />
      <span>{label}</span>
      <span className="font-medium text-primary">{value}</span>
    </div>
  );
}

function AnnouncementCard({
  announcement,
  onOpenDetails,
}: {
  announcement: TProjectAnnouncement;
  onOpenDetails: () => void;
}) {
  const { t } = useTranslation();
  const stats = announcement.statistics;
  const readPercent = stats?.total ? Math.round((stats.read / stats.total) * 100) : 0;
  return (
    <article className="shadow-sm overflow-hidden rounded-xl border border-subtle bg-surface-1 transition-colors hover:border-strong">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption-sm-medium",
                announcement.announcement_type === "important"
                  ? "bg-red-500/10 text-red-500"
                  : "bg-accent-primary/10 text-accent-primary"
              )}
            >
              {announcement.announcement_type === "important" ? (
                <MessageSquareWarning className="size-3.5" />
              ) : (
                <Bell className="size-3.5" />
              )}
              {t(`project_settings.announcements.types.${announcement.announcement_type}`)}
            </span>
            <span className="text-caption-sm-regular text-tertiary">
              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(announcement.sent_at)
              )}
            </span>
          </div>
          <h3 className="truncate text-body-md-semibold text-primary">{announcement.title}</h3>
          <p className="line-clamp-2 max-w-3xl text-body-sm-regular text-secondary">{announcement.content_plain}</p>
          {announcement.attachments.length > 0 && (
            <div className="flex items-center gap-1.5 text-caption-sm-regular text-tertiary">
              <Paperclip className="size-3.5" />
              {t("project_settings.announcements.attachment_count", { count: announcement.attachments.length })}
            </div>
          )}
        </div>
        <div className="min-w-52 rounded-lg border border-subtle bg-layer-1 p-3">
          <div className="mb-2 flex items-center justify-between text-caption-sm-medium">
            <span className="text-secondary">{t("project_settings.announcements.read_rate")}</span>
            <span className="text-primary">{readPercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-layer-3">
            <div className="h-full rounded-full bg-accent-primary" style={{ width: `${readPercent}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <DeliveryCount
              icon={Users}
              label={t("project_settings.announcements.recipients_short")}
              value={stats?.total ?? 0}
            />
            <DeliveryCount
              icon={CheckCheck}
              label={t("project_settings.announcements.read_short")}
              value={stats?.read ?? 0}
            />
            <DeliveryCount icon={Mail} label="Email" value={stats?.email.sent ?? 0} />
            <DeliveryCount icon={Smartphone} label="Telegram" value={stats?.telegram.sent ?? 0} />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            prependIcon={<Eye className="size-3.5" />}
            onClick={onOpenDetails}
          >
            {t("project_settings.announcements.view_details")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function DeliveryStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-caption-sm-medium",
        status === "sent" && "bg-green-500/10 text-green-600",
        status === "failed" && "bg-red-500/10 text-red-500",
        status === "pending" && "bg-amber-500/10 text-amber-600",
        status === "skipped" && "bg-layer-2 text-secondary"
      )}
    >
      {t(`project_settings.announcements.delivery_status.${status}`)}
    </span>
  );
}

function AnnouncementDetailsModal({
  isOpen,
  onClose,
  workspaceSlug,
  projectId,
  announcementId,
}: Props & { isOpen: boolean; onClose: () => void; announcementId: string | null }) {
  const { t } = useTranslation();
  const { data: announcement, isLoading } = useSWR(
    isOpen && announcementId ? `PROJECT_ANNOUNCEMENT_DETAIL_${workspaceSlug}_${projectId}_${announcementId}` : null,
    () => projectAnnouncementService.getAdminDetail(workspaceSlug, projectId, announcementId as string),
    { revalidateOnFocus: false }
  );

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.VXL}>
      <div className="flex max-h-[82vh] flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b border-subtle px-6 py-5">
          <div className="min-w-0 pr-4">
            <div className="text-body-lg-semibold truncate text-primary">
              {announcement?.title ?? t("project_settings.announcements.delivery_details")}
            </div>
            <p className="mt-1 text-body-sm-regular text-secondary">
              {t("project_settings.announcements.delivery_details_description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-secondary hover:bg-layer-1 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto p-6">
          {isLoading || !announcement ? (
            <div className="py-10 text-center text-body-sm-regular text-secondary">{t("common.loading")}</div>
          ) : (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DeliveryCount
                  icon={Users}
                  label={t("project_settings.announcements.recipients_short")}
                  value={announcement.statistics?.total ?? 0}
                />
                <DeliveryCount
                  icon={CheckCheck}
                  label={t("project_settings.announcements.read_short")}
                  value={announcement.statistics?.read ?? 0}
                />
                <DeliveryCount icon={Mail} label="Email" value={announcement.statistics?.email.sent ?? 0} />
                <DeliveryCount icon={Smartphone} label="Telegram" value={announcement.statistics?.telegram.sent ?? 0} />
              </div>
              <div className="overflow-hidden rounded-xl border border-subtle">
                <div className="grid grid-cols-[minmax(180px,1fr)_110px_110px_110px] gap-3 border-b border-subtle bg-layer-1 px-4 py-2.5 text-caption-sm-medium text-secondary">
                  <span>{t("project_settings.announcements.recipient")}</span>
                  <span>{t("project_settings.announcements.read_status")}</span>
                  <span>Email</span>
                  <span>Telegram</span>
                </div>
                <div className="divide-y divide-subtle">
                  {announcement.recipients?.map((recipient) => (
                    <div
                      key={recipient.id}
                      className="grid grid-cols-[minmax(180px,1fr)_110px_110px_110px] items-center gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar
                          name={getUserFullName(recipient.user_details)}
                          src={getFileURL(recipient.user_details.avatar_url)}
                          size={28}
                          shape="circle"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-body-sm-medium text-primary">
                            {getUserFullName(recipient.user_details)}
                          </div>
                          <div className="truncate text-caption-sm-regular text-tertiary">
                            {recipient.user_details.email}
                          </div>
                        </div>
                      </div>
                      <span className={recipient.read_at ? "text-green-600" : "text-secondary"}>
                        {recipient.read_at
                          ? t("project_settings.announcements.read")
                          : t("project_settings.announcements.unread")}
                      </span>
                      <DeliveryStatus status={recipient.email_status} />
                      <DeliveryStatus status={recipient.telegram_status} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalCore>
  );
}

function UserRow({ user, checked, onChange }: { user: IUserLite; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-layer-1">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent-primary size-4" />
      <Avatar name={getUserFullName(user)} src={getFileURL(user.avatar_url)} size={28} shape="circle" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm-medium text-primary">{getUserFullName(user)}</span>
        <span className="block truncate text-caption-sm-regular text-tertiary">{user.email}</span>
      </span>
    </label>
  );
}

function CreateAnnouncementModal({
  isOpen,
  onClose,
  onCreated,
  workspaceSlug,
  projectId,
  options,
  workspaceId,
}: Props & {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  options: TProjectAnnouncementOptions;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<TCreateProjectAnnouncement>(emptyPayload);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return options.users;
    return options.users.filter((user) =>
      `${getUserFullName(user)} ${user.email ?? ""}`.toLocaleLowerCase().includes(query)
    );
  }, [options.users, search]);
  const selectedRecipientCount = payload.all_members
    ? options.users.length
    : new Set([
        ...payload.user_ids,
        ...options.groups
          .filter((group) => payload.group_ids.includes(group.id))
          .flatMap((group) =>
            group.members.filter((member) => member.project_member_active).map((member) => member.member_id)
          ),
      ]).size;

  const close = () => {
    if (isSaving) return;
    setPayload(emptyPayload);
    setSearch("");
    onClose();
  };
  const toggleListValue = (key: "user_ids" | "group_ids", value: string) =>
    setPayload((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((id) => id !== value) : [...current[key], value],
    }));

  const submit = async () => {
    const text = payload.content_html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (!payload.title.trim() || !text || selectedRecipientCount === 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.announcements.validation_title"),
        message: t("project_settings.announcements.validation_message"),
      });
      return;
    }
    setIsSaving(true);
    try {
      await projectAnnouncementService.create(workspaceSlug, projectId, payload);
      await onCreated();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_settings.announcements.sent") });
      setPayload(emptyPayload);
      setSearch("");
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: errorMessage(error, t("project_settings.announcements.send_failed")),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={close} position={EModalPosition.CENTER} width={EModalWidth.VXL}>
      <div className="flex max-h-[90vh] flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b border-subtle px-6 py-5">
          <div>
            <div className="text-body-lg-semibold mb-1 flex items-center gap-2 text-primary">
              <Megaphone className="size-5 text-accent-primary" />
              {t("project_settings.announcements.compose")}
            </div>
            <p className="text-body-sm-regular text-secondary">
              {t("project_settings.announcements.compose_description")}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1.5 text-secondary hover:bg-layer-1 hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-h-0 space-y-5 overflow-y-auto p-6">
            <section>
              <div className="mb-2 text-caption-sm-medium text-secondary">
                {t("project_settings.announcements.notification_type")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["standard", "important"] as TProjectAnnouncementType[]).map((type) => {
                  const Icon = type === "important" ? MessageSquareWarning : Bell;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPayload((current) => ({ ...current, announcement_type: type }))}
                      className={cn(
                        "rounded-xl border p-4 text-left transition-all",
                        payload.announcement_type === type
                          ? "border-accent-primary shadow-sm bg-accent-primary/5"
                          : "border-subtle bg-surface-1 hover:border-strong"
                      )}
                    >
                      <Icon
                        className={cn("mb-3 size-5", type === "important" ? "text-red-500" : "text-accent-primary")}
                      />
                      <div className="text-body-sm-semibold text-primary">
                        {t(`project_settings.announcements.types.${type}`)}
                      </div>
                      <div className="mt-1 text-caption-sm-regular text-secondary">
                        {t(`project_settings.announcements.type_help.${type}`)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <label className="block">
              <span className="mb-2 block text-caption-sm-medium text-secondary">
                {t("project_settings.announcements.title")}
              </span>
              <input
                value={payload.title}
                maxLength={255}
                onChange={(event) => setPayload((current) => ({ ...current, title: event.target.value }))}
                placeholder={t("project_settings.announcements.title_placeholder")}
                className={inputClass}
              />
            </label>

            <section>
              <div className="mb-2 text-caption-sm-medium text-secondary">
                {t("project_settings.announcements.message")}
              </div>
              <LiteTextEditor
                key={isOpen ? "announcement-editor-open" : "announcement-editor-closed"}
                editable
                id="project-announcement-editor"
                initialValue={payload.content_html}
                value={payload.content_html}
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                projectId={projectId}
                onChange={(_json, htmlValue) => setPayload((current) => ({ ...current, content_html: htmlValue }))}
                uploadFile={async () => {
                  throw new Error("Use the attachments section below.");
                }}
                duplicateFile={async () => {
                  throw new Error("Use the attachments section below.");
                }}
                showSubmitButton={false}
                placeholder={t("project_settings.announcements.message_placeholder")}
                parentClassName="min-h-44 bg-surface-1"
                editorClassName="min-h-28"
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-caption-sm-medium text-secondary">
                  {t("project_settings.announcements.attachments")}
                </span>
                <span className="text-caption-sm-regular text-tertiary">
                  {t("project_settings.announcements.project_limits_apply")}
                </span>
              </div>
              <label
                className="hover:border-accent-primary flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-subtle bg-layer-1/50 px-4 py-5 text-center transition-colors"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setPayload((current) => ({
                    ...current,
                    attachments: [...current.attachments, ...Array.from(event.dataTransfer.files)],
                  }));
                }}
              >
                <Paperclip className="mb-2 size-5 text-accent-primary" />
                <span className="text-body-sm-medium text-primary">
                  {t("project_settings.announcements.attach_or_drop")}
                </span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) =>
                    setPayload((current) => ({
                      ...current,
                      attachments: [...current.attachments, ...Array.from(event.target.files ?? [])],
                    }))
                  }
                />
              </label>
              {payload.attachments.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {payload.attachments.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center gap-2 rounded-lg bg-layer-1 px-3 py-2"
                    >
                      <FileText className="size-4 text-secondary" />
                      <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">{file.name}</span>
                      <span className="text-caption-sm-regular text-tertiary">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPayload((current) => ({
                            ...current,
                            attachments: current.attachments.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                        className="rounded p-1 text-secondary hover:bg-layer-2 hover:text-primary"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-subtle bg-layer-1/40 p-5 lg:border-t-0 lg:border-l">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-body-sm-semibold text-primary">
                  {t("project_settings.announcements.recipients")}
                </div>
                <div className="text-caption-sm-regular text-secondary">
                  {t("project_settings.announcements.recipient_count", { count: selectedRecipientCount })}
                </div>
              </div>
              <Users className="size-5 text-accent-primary" />
            </div>

            <label
              aria-label={t("project_settings.announcements.all_members")}
              className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-subtle bg-surface-1 p-3"
            >
              <input
                type="checkbox"
                checked={payload.all_members}
                onChange={(event) => setPayload((current) => ({ ...current, all_members: event.target.checked }))}
                className="accent-accent-primary mt-0.5 size-4"
              />
              <span>
                <span className="block text-body-sm-medium text-primary">
                  {t("project_settings.announcements.all_members")}
                </span>
                <span className="block text-caption-sm-regular text-secondary">
                  {t("project_settings.announcements.all_members_help")}
                </span>
              </span>
            </label>

            {options.groups.length > 0 && (
              <section className="mb-5">
                <div className="mb-2 text-caption-sm-medium text-secondary">
                  {t("project_settings.announcements.groups")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {options.groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => toggleListValue("group_ids", group.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-caption-sm-medium transition-colors",
                        payload.group_ids.includes(group.id)
                          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                          : "border-subtle bg-surface-1 text-secondary hover:border-strong hover:text-primary"
                      )}
                    >
                      {group.name} · {group.members.filter((member) => member.project_member_active).length}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-2 text-caption-sm-medium text-secondary">
                {t("project_settings.announcements.individual_users")}
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("project_settings.announcements.search_users")}
                className={`${inputClass} mb-2`}
              />
              <div className="max-h-72 overflow-y-auto rounded-xl border border-subtle bg-surface-1 p-1">
                {filteredUsers.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    checked={payload.user_ids.includes(user.id)}
                    onChange={() => toggleListValue("user_ids", user.id)}
                  />
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="flex items-center justify-between border-t border-subtle bg-surface-1 px-6 py-4">
          <p className="hidden text-caption-sm-regular text-secondary sm:block">
            {t("project_settings.announcements.immutable_hint")}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={close} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" prependIcon={<Send className="size-4" />} onClick={submit} loading={isSaving}>
              {t("project_settings.announcements.send")}
            </Button>
          </div>
        </footer>
      </div>
    </ModalCore>
  );
}

export function ProjectAnnouncementsSettings({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { getWorkspaceBySlug } = useWorkspace();
  const workspace = getWorkspaceBySlug(workspaceSlug);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null);
  const {
    data: announcements = [],
    mutate: mutateAnnouncements,
    isLoading,
  } = useSWR(
    workspaceSlug && projectId ? `PROJECT_ANNOUNCEMENTS_${workspaceSlug}_${projectId}` : null,
    () => projectAnnouncementService.list(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );
  const { data: options } = useSWR(
    workspaceSlug && projectId ? `PROJECT_ANNOUNCEMENT_OPTIONS_${workspaceSlug}_${projectId}` : null,
    () => projectAnnouncementService.getOptions(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-subtle bg-gradient-to-r from-accent-primary/8 via-surface-1 to-surface-1 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
            <Megaphone className="size-5" />
          </div>
          <div>
            <div className="text-body-md-semibold text-primary">
              {t("project_settings.announcements.control_title")}
            </div>
            <p className="mt-1 max-w-2xl text-body-sm-regular text-secondary">
              {t("project_settings.announcements.control_description")}
            </p>
          </div>
        </div>
        <Button variant="primary" prependIcon={<Plus className="size-4" />} onClick={() => setIsCreateOpen(true)}>
          {t("project_settings.announcements.create")}
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-subtle bg-surface-1 p-8 text-center text-secondary">
          {t("common.loading")}
        </div>
      ) : announcements.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-subtle bg-layer-1/30 px-6 py-14 text-center">
          <Megaphone className="mb-4 size-8 text-tertiary" />
          <h3 className="text-body-md-semibold text-primary">{t("project_settings.announcements.empty_title")}</h3>
          <p className="mt-1 max-w-md text-body-sm-regular text-secondary">
            {t("project_settings.announcements.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onOpenDetails={() => setSelectedAnnouncementId(announcement.id)}
            />
          ))}
        </div>
      )}

      {workspace?.id && options && (
        <CreateAnnouncementModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onCreated={async () => {
            await mutateAnnouncements();
          }}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          workspaceId={workspace.id}
          options={options}
        />
      )}
      <AnnouncementDetailsModal
        isOpen={Boolean(selectedAnnouncementId)}
        onClose={() => setSelectedAnnouncementId(null)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        announcementId={selectedAnnouncementId}
      />
    </div>
  );
}
