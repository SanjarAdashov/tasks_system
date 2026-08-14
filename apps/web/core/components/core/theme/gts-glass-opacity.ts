/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const GTS_GLASS_DEFAULT_WORKSPACE_OPACITY = 50;
export const GTS_GLASS_MIN_WORKSPACE_OPACITY = 10;
export const GTS_GLASS_MAX_WORKSPACE_OPACITY = 80;

export const GTS_GLASS_DEFAULT_TASK_OPACITY = 80;
export const GTS_GLASS_MIN_TASK_OPACITY = 10;
export const GTS_GLASS_MAX_TASK_OPACITY = 95;

const GTS_GLASS_LEGACY_MIN_TASK_OPACITY = 55;
const GTS_GLASS_MIN_TASK_SURFACE_OPACITY = 0.1;

type TOpacitySpec = readonly [property: string, baseOpacity: number, response: number, min: number, max: number];

const WORKSPACE_OPACITY_SPECS: readonly TOpacitySpec[] = [
  ["--gts-glass-bg-surface-1-opacity", 0.56, 0.6, 0.26, 0.9],
  ["--gts-glass-bg-surface-2-opacity", 0.66, 0.55, 0.36, 0.92],
  ["--gts-glass-bg-layer-1-opacity", 0.7, 0.5, 0.4, 0.94],
  ["--gts-glass-bg-layer-1-hover-opacity", 0.78, 0.45, 0.48, 0.96],
  ["--gts-glass-bg-layer-1-active-opacity", 0.84, 0.4, 0.54, 0.97],
  ["--gts-glass-bg-layer-1-selected-opacity", 0.86, 0.38, 0.56, 0.98],
  ["--gts-glass-workspace-opacity", 0.34, 0.85, 0.12, 0.76],
  ["--gts-glass-sidebar-opacity", 0.68, 0.55, 0.42, 0.9],
  ["--gts-glass-kanban-surface-opacity", 0.42, 0.8, 0.16, 0.82],
  ["--gts-glass-kanban-column-opacity", 0.48, 0.75, 0.2, 0.86],
  ["--gts-glass-list-surface-opacity", 0.72, 0.55, 0.46, 0.94],
  ["--gts-glass-spreadsheet-surface-opacity", 0.82, 0.4, 0.62, 0.96],
];

const TASK_OPACITY_SPECS: readonly TOpacitySpec[] = [
  ["--gts-glass-kanban-card-opacity", 0.8, 1, 0.5, 0.96],
  ["--gts-glass-list-row-opacity", 0.78, 0.95, 0.48, 0.95],
  ["--gts-glass-spreadsheet-row-opacity", 0.56, 1.7, 0.25, 0.9],
];

const normalizeOpacity = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;

  return Math.min(max, Math.max(min, Math.round(value)));
};

export const normalizeGtsGlassWorkspaceOpacity = (value: number | undefined): number =>
  normalizeOpacity(
    value,
    GTS_GLASS_DEFAULT_WORKSPACE_OPACITY,
    GTS_GLASS_MIN_WORKSPACE_OPACITY,
    GTS_GLASS_MAX_WORKSPACE_OPACITY
  );

export const normalizeGtsGlassTaskOpacity = (value: number | undefined): number =>
  normalizeOpacity(value, GTS_GLASS_DEFAULT_TASK_OPACITY, GTS_GLASS_MIN_TASK_OPACITY, GTS_GLASS_MAX_TASK_OPACITY);

const getOpacityTokens = (
  value: number,
  defaultValue: number,
  specs: readonly TOpacitySpec[]
): Record<string, string> => {
  const delta = (value - defaultValue) / 100;

  return Object.fromEntries(
    specs.map(([property, baseOpacity, response, min, max]) => [
      property,
      Math.min(max, Math.max(min, baseOpacity + delta * response)).toFixed(3),
    ])
  );
};

const getTaskOpacityTokens = (value: number | undefined): Record<string, string> => {
  const normalizedValue = normalizeGtsGlassTaskOpacity(value);

  if (normalizedValue >= GTS_GLASS_LEGACY_MIN_TASK_OPACITY)
    return getOpacityTokens(normalizedValue, GTS_GLASS_DEFAULT_TASK_OPACITY, TASK_OPACITY_SPECS);

  const legacyMinimumTokens = getOpacityTokens(
    GTS_GLASS_LEGACY_MIN_TASK_OPACITY,
    GTS_GLASS_DEFAULT_TASK_OPACITY,
    TASK_OPACITY_SPECS
  );
  const progress =
    (normalizedValue - GTS_GLASS_MIN_TASK_OPACITY) / (GTS_GLASS_LEGACY_MIN_TASK_OPACITY - GTS_GLASS_MIN_TASK_OPACITY);

  return Object.fromEntries(
    Object.entries(legacyMinimumTokens).map(([property, legacyMinimum]) => [
      property,
      (
        GTS_GLASS_MIN_TASK_SURFACE_OPACITY +
        (Number(legacyMinimum) - GTS_GLASS_MIN_TASK_SURFACE_OPACITY) * progress
      ).toFixed(3),
    ])
  );
};

export const getGtsGlassOpacityTokens = (
  workspaceOpacity: number | undefined,
  taskOpacity: number | undefined
): Record<string, string> => {
  const workspaceTokens = getOpacityTokens(
    normalizeGtsGlassWorkspaceOpacity(workspaceOpacity),
    GTS_GLASS_DEFAULT_WORKSPACE_OPACITY,
    WORKSPACE_OPACITY_SPECS
  );
  const taskTokens = getTaskOpacityTokens(taskOpacity);
  const listRowOpacity = Number(taskTokens["--gts-glass-list-row-opacity"]);
  const spreadsheetRowOpacity = Number(taskTokens["--gts-glass-spreadsheet-row-opacity"]);

  return {
    ...workspaceTokens,
    ...taskTokens,
    "--gts-glass-list-row-hover-opacity": Math.min(0.98, listRowOpacity + 0.08).toFixed(3),
    "--gts-glass-spreadsheet-row-hover-opacity": Math.min(0.96, spreadsheetRowOpacity + 0.08).toFixed(3),
  };
};

export const applyGtsGlassOpacity = (workspaceOpacity: number | undefined, taskOpacity: number | undefined): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  Object.entries(getGtsGlassOpacityTokens(workspaceOpacity, taskOpacity)).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
};

export const clearGtsGlassOpacity = (): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  Object.keys(getGtsGlassOpacityTokens(undefined, undefined)).forEach((property) => {
    root.style.removeProperty(property);
  });
};
