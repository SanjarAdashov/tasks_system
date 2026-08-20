import { PageHead } from "@/components/core/page-title";
import { AnnouncementDetail } from "@/components/project/announcements/announcement-detail";
import type { Route } from "./+types/page";

export default function ProjectAnnouncementPage({ params }: Route.ComponentProps) {
  return (
    <>
      <PageHead title="GTS Tasks System" />
      <AnnouncementDetail workspaceSlug={params.workspaceSlug} announcementId={params.announcementId} />
    </>
  );
}
