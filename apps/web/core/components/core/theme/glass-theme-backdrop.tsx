/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";
// plane imports
import { GTS_GLASS_THEME } from "@plane/constants";
// assets
import gtsTasksWallpaper from "@/app/assets/backgrounds/gts-tasks-airport-sunset.png?url";
// hooks
import { useUserProfile } from "@/hooks/store/user";
import { useInstance } from "@/hooks/store/use-instance";
// utils
import { getFileURL } from "@plane/utils";
// local imports
import { applyGtsGlassColor, clearGtsGlassColor } from "./gts-glass-accent";
import { applyGtsGlassOpacity, clearGtsGlassOpacity } from "./gts-glass-opacity";

export const GlassThemeBackdrop = observer(function GlassThemeBackdrop() {
  const { resolvedTheme } = useTheme();
  const { data: userProfile } = useUserProfile();
  const { config: instanceConfig } = useInstance();
  const accentColor = userProfile?.theme?.glassAccentColor ?? instanceConfig?.default_glass_accent_color;
  const workspaceOpacity = userProfile?.theme?.glassWorkspaceOpacity;
  const taskOpacity = userProfile?.theme?.glassTaskOpacity;

  useEffect(() => {
    if (resolvedTheme !== GTS_GLASS_THEME) {
      clearGtsGlassColor();
      return;
    }

    applyGtsGlassColor(accentColor);

    return clearGtsGlassColor;
  }, [accentColor, resolvedTheme]);

  useEffect(() => {
    if (resolvedTheme !== GTS_GLASS_THEME) {
      clearGtsGlassOpacity();
      return;
    }

    applyGtsGlassOpacity(workspaceOpacity, taskOpacity);

    return clearGtsGlassOpacity;
  }, [resolvedTheme, taskOpacity, workspaceOpacity]);

  if (resolvedTheme !== GTS_GLASS_THEME) return null;

  const userBackground = userProfile?.theme?.glassBackground;
  const background =
    !userBackground || userBackground === "inherit"
      ? (instanceConfig?.default_glass_background ?? "gts-tasks")
      : userBackground;
  const customBackgroundUrl = userProfile?.theme?.glassBackgroundUrl ?? instanceConfig?.default_glass_background_url;
  const wallpaperUrl =
    background === "custom" && customBackgroundUrl
      ? getFileURL(customBackgroundUrl) || customBackgroundUrl
      : gtsTasksWallpaper;
  const overlayOpacity =
    Math.min(
      58,
      Math.max(42, userProfile?.theme?.glassOverlayOpacity ?? instanceConfig?.default_glass_overlay_opacity ?? 46)
    ) / 100;

  return (
    <div className="gts-glass-backdrop" aria-hidden="true">
      {background !== "none" && <img className="gts-glass-wallpaper" src={wallpaperUrl} alt="" />}
      <div className="gts-glass-wallpaper-overlay" style={{ opacity: overlayOpacity }} />
    </div>
  );
});
