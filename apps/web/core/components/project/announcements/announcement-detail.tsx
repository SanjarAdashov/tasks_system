import { useNavigate } from "react-router";
import useSWR from "swr";
import { ArrowLeft, Bell, BellRing, Download, FileText, Paperclip } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Avatar, Loader } from "@plane/ui";
import { calculateTimeAgo, getFileURL, getUserFullName } from "@plane/utils";
import projectAnnouncementService from "@/services/project-announcement.service";

type Props = {
  workspaceSlug: string;
  announcementId: string;
};

export function AnnouncementDetail({ workspaceSlug, announcementId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: announcement, isLoading } = useSWR(
    workspaceSlug && announcementId ? `PROJECT_ANNOUNCEMENT_${workspaceSlug}_${announcementId}` : null,
    () => projectAnnouncementService.getDetail(workspaceSlug, announcementId),
    { revalidateOnFocus: false }
  );

  if (isLoading)
    return (
      <div className="mx-auto w-full max-w-4xl p-8">
        <Loader className="space-y-5">
          <Loader.Item height="38px" width="55%" />
          <Loader.Item height="180px" />
        </Loader>
      </div>
    );

  if (!announcement)
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <Bell className="mx-auto mb-3 size-8 text-tertiary" />
          <h1 className="text-heading-md-semibold text-primary">{t("notification.announcement.not_found")}</h1>
        </div>
      </div>
    );

  const author = announcement.created_by_details;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-7 lg:px-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-5 inline-flex h-8 items-center gap-2 rounded-md px-2 text-body-sm-medium text-secondary transition hover:bg-layer-1 hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        {t("notification.announcement.back")}
      </button>

      <article className="shadow-sm overflow-hidden rounded-xl border border-subtle bg-surface-1">
        <header className="border-b border-subtle bg-layer-1 px-6 py-6 lg:px-8">
          <div className="flex items-start gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-primary/10 text-accent-primary">
              {announcement.announcement_type === "important" ? (
                <BellRing className="size-5" />
              ) : (
                <Bell className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-caption-md-medium text-secondary">
                {announcement.announcement_type === "important"
                  ? t("notification.announcement.important")
                  : t("notification.announcement.standard")}
              </p>
              <h1 className="text-heading-xl-semibold mt-1 text-primary">{announcement.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-caption-md-regular text-tertiary">
                {author && (
                  <>
                    <Avatar
                      name={getUserFullName(author)}
                      src={getFileURL(author.avatar_url)}
                      size={20}
                      shape="circle"
                    />
                    <span>{getUserFullName(author)}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>{calculateTimeAgo(announcement.sent_at)}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 py-7 lg:px-8">
          <div
            className="prose-sm max-w-none text-primary prose"
            dangerouslySetInnerHTML={{ __html: announcement.content_html }}
          />

          {announcement.attachments.length > 0 && (
            <section className="mt-8 border-t border-subtle pt-5">
              <h2 className="mb-3 flex items-center gap-2 text-body-sm-medium text-primary">
                <Paperclip className="size-4 text-secondary" />
                {t("notification.announcement.attachments")}
                <span className="rounded-full bg-layer-2 px-2 py-0.5 text-caption-sm-medium text-secondary">
                  {announcement.attachments.length}
                </span>
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {announcement.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.download_url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex min-w-0 items-center gap-3 rounded-lg border border-subtle bg-layer-1 p-3 transition hover:border-strong hover:bg-layer-2"
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-1 text-secondary">
                      <FileText className="size-4" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">{attachment.name}</span>
                    <Download className="size-4 shrink-0 text-tertiary transition group-hover:text-primary" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </article>
    </main>
  );
}
