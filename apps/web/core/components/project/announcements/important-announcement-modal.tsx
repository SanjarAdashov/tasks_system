import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import useSWR from "swr";
import { BellRing, ExternalLink, FileText, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { calculateTimeAgo } from "@plane/utils";
import projectAnnouncementService from "@/services/project-announcement.service";

type Props = {
  workspaceSlug: string;
};

export function ImportantAnnouncementModal({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const { data } = useSWR(
    workspaceSlug ? `IMPORTANT_PROJECT_ANNOUNCEMENTS_${workspaceSlug}` : null,
    () => projectAnnouncementService.listImportant(workspaceSlug),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const announcement = useMemo(() => data?.find((item) => !dismissedIds.includes(item.id)), [data, dismissedIds]);

  const dismiss = async () => {
    if (!announcement) return;
    setDismissedIds((current) => [...current, announcement.id]);
    try {
      await projectAnnouncementService.dismiss(workspaceSlug, announcement.id);
    } catch {
      // Dismissal is intentionally session-local first. A failed statistics
      // update must not trap the user in the modal.
    }
  };

  const openAnnouncement = () => {
    if (!announcement) return;
    setDismissedIds((current) => [...current, announcement.id]);
    navigate(`/${workspaceSlug}/notifications/announcements/${announcement.id}`);
  };

  return (
    <ModalCore
      isOpen={Boolean(announcement)}
      handleClose={dismiss}
      width={EModalWidth.LG}
      position={EModalPosition.CENTER}
      className="!max-w-[620px] overflow-hidden !rounded-2xl !border !border-subtle !bg-surface-1 !shadow-raised-200"
    >
      {announcement && (
        <article className="relative bg-surface-1 text-primary">
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("close")}
            className="absolute top-4 right-4 z-10 grid size-8 place-items-center rounded-full border border-subtle bg-surface-1 text-secondary transition hover:bg-layer-1 hover:text-primary"
          >
            <X className="size-4" />
          </button>

          <header className="border-b border-subtle bg-layer-1 px-6 py-5 pr-16">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <BellRing className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-caption-md-medium tracking-wide text-accent-primary uppercase">
                  {t("notification.announcement.important")}
                </p>
                <h2 className="text-heading-md-semibold mt-0.5 truncate">{announcement.title}</h2>
              </div>
            </div>
          </header>

          <div className="max-h-[56vh] overflow-y-auto px-6 py-5">
            <div
              className="prose-sm max-w-none text-primary prose"
              dangerouslySetInnerHTML={{ __html: announcement.content_html }}
            />
            {announcement.attachments.length > 0 && (
              <div className="mt-5 border-t border-subtle pt-4">
                <p className="mb-2 text-body-sm-medium text-primary">{t("notification.announcement.attachments")}</p>
                <div className="flex flex-col gap-2">
                  {announcement.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.download_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular text-primary transition hover:border-strong"
                    >
                      <FileText className="size-4 shrink-0 text-secondary" />
                      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                      <ExternalLink className="size-3.5 shrink-0 text-tertiary" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-4 border-t border-subtle bg-layer-1 px-6 py-4">
            <span className="truncate text-caption-md-regular text-tertiary">
              {announcement.sent_at && calculateTimeAgo(announcement.sent_at)}
            </span>
            <button
              type="button"
              onClick={openAnnouncement}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-accent-primary px-4 text-body-sm-medium text-on-color transition hover:bg-accent-primary-hover"
            >
              {t("notification.announcement.open")}
              <ExternalLink className="size-4" />
            </button>
          </footer>
        </article>
      )}
    </ModalCore>
  );
}
