/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { API_BASE_URL } from "@plane/constants";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { WorkspaceAuthWrapper } from "@/layouts/auth-layout/workspace-wrapper";
import { LogoSpinner } from "@/components/common/logo-spinner";
// oxlint-disable-next-line import/no-unassigned-import -- route-scoped Mini App theme
import "../telegram-mini-app.css";

function TelegramMiniAppAccessGuard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/api/telegram/mini-app/access/`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((payload) => active && setAllowed(Boolean(payload.allowed)))
      .catch(() => {
        if (active) window.location.replace("/telegram-app");
      });
    return () => {
      active = false;
    };
  }, []);

  if (!allowed)
    return (
      <div className="tg-mini-app tg-mini-app--centered">
        <LogoSpinner />
      </div>
    );
  return <Outlet />;
}

export default function TelegramMiniAppWorkspaceLayout() {
  return (
    <AuthenticationWrapper>
      <WorkspaceAuthWrapper>
        <TelegramMiniAppAccessGuard />
      </WorkspaceAuthWrapper>
    </AuthenticationWrapper>
  );
}
