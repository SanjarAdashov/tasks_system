/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { getRelativeLuminance, normalizeHexColor, validateHexColor } from "@plane/utils";

export const GTS_GLASS_DEFAULT_ACCENT = "#19A7F6";

export const GTS_GLASS_ACCENT_PRESETS = [
  { label: "Cyan", value: GTS_GLASS_DEFAULT_ACCENT },
  { label: "Azure", value: "#4F8CFF" },
  { label: "Violet", value: "#8B7CFF" },
  { label: "Orchid", value: "#C86BFA" },
  { label: "Coral", value: "#FF786B" },
  { label: "Amber", value: "#F6B94A" },
  { label: "Emerald", value: "#2CD6A3" },
] as const;

export const isValidGtsGlassAccent = (value: string | undefined): value is string => !!value && validateHexColor(value);

export const normalizeGtsGlassAccent = (value: string | undefined): string =>
  isValidGtsGlassAccent(value) ? `#${normalizeHexColor(value)}` : GTS_GLASS_DEFAULT_ACCENT;

const getOnAccentColor = (accentColor: string): string =>
  getRelativeLuminance(accentColor) >= 0.2 ? "#021326" : "#F4F8FC";

type TRgb = {
  r: number;
  g: number;
  b: number;
};

const parseHexColor = (hexColor: string): TRgb => {
  const normalized = normalizeHexColor(hexColor);

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const tintGlassTone = (baseColor: string, accentColor: string, strength: number): string => {
  const base = parseHexColor(baseColor);
  const accent = parseHexColor(accentColor);
  const defaultAccent = parseHexColor(GTS_GLASS_DEFAULT_ACCENT);
  const shiftChannel = (baseChannel: number, accentChannel: number, defaultChannel: number) =>
    Math.min(255, Math.max(0, Math.round(baseChannel + (accentChannel - defaultChannel) * strength)));

  return [
    shiftChannel(base.r, accent.r, defaultAccent.r),
    shiftChannel(base.g, accent.g, defaultAccent.g),
    shiftChannel(base.b, accent.b, defaultAccent.b),
  ].join(" ");
};

const GLASS_TONE_SPECS = [
  ["--gts-glass-canvas-rgb", "#021326", 0.08],
  ["--gts-glass-surface-rgb", "#082640", 0.18],
  ["--gts-glass-deep-rgb", "#031426", 0.14],
  ["--gts-glass-layer-1-hover-rgb", "#103958", 0.18],
  ["--gts-glass-layer-1-active-rgb", "#144467", 0.2],
  ["--gts-glass-layer-2-hover-rgb", "#0A2F4C", 0.17],
  ["--gts-glass-layer-2-active-rgb", "#0D395B", 0.18],
  ["--gts-glass-layer-3-hover-rgb", "#082843", 0.16],
  ["--gts-glass-layer-3-active-rgb", "#0B3252", 0.17],
] as const;

export const getGtsGlassColorTokens = (accentColor: string | undefined): Record<string, string> => {
  const normalizedAccent = normalizeGtsGlassAccent(accentColor);
  const glassTokens = Object.fromEntries(
    GLASS_TONE_SPECS.map(([property, baseColor, strength]) => [
      property,
      tintGlassTone(baseColor, normalizedAccent, strength),
    ])
  );

  return {
    "--gts-glass-accent": normalizedAccent,
    "--gts-glass-on-accent": getOnAccentColor(normalizedAccent),
    ...glassTokens,
  };
};

export const applyGtsGlassColor = (accentColor: string | undefined): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  Object.entries(getGtsGlassColorTokens(accentColor)).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
};

export const clearGtsGlassColor = (): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  Object.keys(getGtsGlassColorTokens(GTS_GLASS_DEFAULT_ACCENT)).forEach((property) => {
    root.style.removeProperty(property);
  });
};
