/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

type THydratedRouterContext = {
  basename?: string;
};

// Public Intake URLs are exposed as `/support/*`, while Caddy internally
// rewrites them to the Space app mounted at `/spaces/*`. SSR therefore uses
// the Space basename, but the browser still sees the public path. Align the
// client router with that visible URL before hydration so React can take over
// the server-rendered page instead of leaving the initial loader in place.
const routerContext = (
  window as typeof window & {
    __reactRouterContext?: THydratedRouterContext;
  }
).__reactRouterContext;

if (window.location.pathname.startsWith("/support/") && routerContext) {
  routerContext.basename = "/";
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
