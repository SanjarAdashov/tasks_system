/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PageHead } from "@/components/core/page-title";
import { CalendarRoot } from "@/components/calendar/calendar-root";
import type { Route } from "./+types/page";

function WorkspaceCalendarPage({ params }: Route.ComponentProps) {
  return (
    <>
      <PageHead title="GTS Calendar" />
      <CalendarRoot workspaceSlug={params.workspaceSlug} />
    </>
  );
}

export default WorkspaceCalendarPage;
