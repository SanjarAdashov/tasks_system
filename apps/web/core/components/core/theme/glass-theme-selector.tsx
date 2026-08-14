/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Check, ImageIcon, ImagePlus, Moon, Palette, RotateCcw, SlidersHorizontal, Upload } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setPromiseToast, setToast } from "@plane/propel/toast";
import { EFileAssetType } from "@plane/types";
import type { IUserTheme } from "@plane/types";
import { InputColorPicker } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// assets
import gtsTasksWallpaper from "@/app/assets/backgrounds/gts-tasks-airport-sunset.png?url";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// services
import { FileService } from "@/services/file.service";
// local imports
import {
  GTS_GLASS_ACCENT_PRESETS,
  GTS_GLASS_DEFAULT_ACCENT,
  applyGtsGlassColor,
  isValidGtsGlassAccent,
  normalizeGtsGlassAccent,
} from "./gts-glass-accent";
import {
  GTS_GLASS_DEFAULT_TASK_OPACITY,
  GTS_GLASS_DEFAULT_WORKSPACE_OPACITY,
  GTS_GLASS_MAX_TASK_OPACITY,
  GTS_GLASS_MAX_WORKSPACE_OPACITY,
  GTS_GLASS_MIN_TASK_OPACITY,
  GTS_GLASS_MIN_WORKSPACE_OPACITY,
  applyGtsGlassOpacity,
  normalizeGtsGlassTaskOpacity,
  normalizeGtsGlassWorkspaceOpacity,
} from "./gts-glass-opacity";

type TGlassBackground = Extract<NonNullable<IUserTheme["glassBackground"]>, "gts-tasks" | "custom" | "none">;

const fileService = new FileService();

const normalizeGlassBackground = (value: IUserTheme["glassBackground"]): TGlassBackground => {
  if (value === "none" || value === "custom") return value;
  return "gts-tasks";
};

export const GlassThemeSelector = observer(function GlassThemeSelector() {
  const { data: userProfile, updateUserTheme } = useUserProfile();
  const savedAccentColor = normalizeGtsGlassAccent(userProfile?.theme?.glassAccentColor);
  const savedBackground = normalizeGlassBackground(userProfile?.theme?.glassBackground);
  const savedBackgroundUrl = userProfile?.theme?.glassBackgroundUrl ?? "";
  const savedOverlayOpacity = userProfile?.theme?.glassOverlayOpacity ?? 46;
  const savedWorkspaceOpacity = normalizeGtsGlassWorkspaceOpacity(userProfile?.theme?.glassWorkspaceOpacity);
  const savedTaskOpacity = normalizeGtsGlassTaskOpacity(userProfile?.theme?.glassTaskOpacity);
  const [accentColor, setAccentColor] = useState(savedAccentColor);
  const [background, setBackground] = useState<TGlassBackground>(savedBackground);
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState(savedBackgroundUrl);
  const [pendingBackgroundFile, setPendingBackgroundFile] = useState<File | null>(null);
  const [pendingBackgroundPreview, setPendingBackgroundPreview] = useState("");
  const [isBackgroundUploading, setIsBackgroundUploading] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(savedOverlayOpacity);
  const [workspaceOpacity, setWorkspaceOpacity] = useState(savedWorkspaceOpacity);
  const [taskOpacity, setTaskOpacity] = useState(savedTaskOpacity);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAccentColor(savedAccentColor);
    setBackground(savedBackground);
    setCustomBackgroundUrl(savedBackgroundUrl);
    setOverlayOpacity(savedOverlayOpacity);
    setWorkspaceOpacity(savedWorkspaceOpacity);
    setTaskOpacity(savedTaskOpacity);
  }, [
    savedAccentColor,
    savedBackground,
    savedBackgroundUrl,
    savedOverlayOpacity,
    savedTaskOpacity,
    savedWorkspaceOpacity,
  ]);

  useEffect(
    () => () => {
      if (pendingBackgroundPreview) URL.revokeObjectURL(pendingBackgroundPreview);
    },
    [pendingBackgroundPreview]
  );

  const normalizedAccentColor = isValidGtsGlassAccent(accentColor)
    ? normalizeGtsGlassAccent(accentColor)
    : savedAccentColor;
  const isAccentColorValid = isValidGtsGlassAccent(accentColor);
  const isAccentDirty = isAccentColorValid && normalizedAccentColor !== savedAccentColor;

  useEffect(() => {
    applyGtsGlassColor(normalizedAccentColor);

    return () => applyGtsGlassColor(savedAccentColor);
  }, [normalizedAccentColor, savedAccentColor]);

  useEffect(() => {
    applyGtsGlassOpacity(workspaceOpacity, taskOpacity);

    return () => applyGtsGlassOpacity(savedWorkspaceOpacity, savedTaskOpacity);
  }, [savedTaskOpacity, savedWorkspaceOpacity, taskOpacity, workspaceOpacity]);

  const isBackgroundDirty = useMemo(
    () => background !== savedBackground || overlayOpacity !== savedOverlayOpacity || pendingBackgroundFile !== null,
    [background, overlayOpacity, pendingBackgroundFile, savedBackground, savedOverlayOpacity]
  );
  const isOpacityDirty = workspaceOpacity !== savedWorkspaceOpacity || taskOpacity !== savedTaskOpacity;

  const handleAccentChange = (value: string) => {
    const nextValue = value.trim();
    setAccentColor(nextValue && !nextValue.startsWith("#") ? `#${nextValue.toUpperCase()}` : nextValue.toUpperCase());
  };

  const handleAccentSave = async () => {
    if (!isAccentColorValid) return;

    const updatePromise = updateUserTheme({
      glassAccentColor: normalizedAccentColor,
    });

    setPromiseToast(updatePromise, {
      loading: "Saving theme color...",
      success: {
        title: "Theme color updated",
        message: () => "Your GTS Glass accents and glass tint are now active.",
      },
      error: {
        title: "Could not save theme color",
        message: () => "Please try again.",
      },
    });

    await updatePromise;
  };

  const handleBackgroundFileChange = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Unsupported file",
        message: "Choose a JPEG, PNG, or WebP image.",
      });
      return;
    }

    setPendingBackgroundFile(file);
    setPendingBackgroundPreview(URL.createObjectURL(file));
    setBackground("custom");
  };

  const handleBackgroundSave = async () => {
    if (background === "custom" && !pendingBackgroundFile && !customBackgroundUrl) {
      backgroundFileInputRef.current?.click();
      return;
    }

    setIsBackgroundUploading(true);
    const updatePromise = (async () => {
      let nextCustomBackgroundUrl = customBackgroundUrl;

      if (background === "custom" && pendingBackgroundFile) {
        const uploadResult = await fileService.uploadUserAsset(
          {
            entity_identifier: "gts-glass-background",
            entity_type: EFileAssetType.USER_COVER,
          },
          pendingBackgroundFile
        );
        nextCustomBackgroundUrl = uploadResult.asset_url;
      }

      await updateUserTheme({
        glassBackground: background,
        glassBackgroundUrl: nextCustomBackgroundUrl,
        glassOverlayOpacity: overlayOpacity,
      });

      setCustomBackgroundUrl(nextCustomBackgroundUrl);
      setPendingBackgroundFile(null);
      setPendingBackgroundPreview("");
    })().finally(() => setIsBackgroundUploading(false));

    setPromiseToast(updatePromise, {
      loading: "Saving glass background...",
      success: {
        title: "Background updated",
        message: () => "Your GTS Glass background is now active.",
      },
      error: {
        title: "Could not save background",
        message: () => "Please try again.",
      },
    });

    await updatePromise;
  };

  const customBackgroundPreview = pendingBackgroundPreview || getFileURL(customBackgroundUrl) || customBackgroundUrl;

  const handleOpacitySave = async () => {
    const updatePromise = updateUserTheme({
      glassWorkspaceOpacity: workspaceOpacity,
      glassTaskOpacity: taskOpacity,
    });

    setPromiseToast(updatePromise, {
      loading: "Saving glass transparency...",
      success: {
        title: "Transparency updated",
        message: () => "Main surfaces and task items now use your selected opacity.",
      },
      error: {
        title: "Could not save transparency",
        message: () => "Please try again.",
      },
    });

    await updatePromise;
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="gts-glass-accent-settings rounded-lg border border-subtle bg-layer-1">
        <div className="flex flex-col gap-1 border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-body-sm-medium text-primary">
            <Palette className="size-4 text-accent-primary" />
            Theme color
          </div>
          <p className="text-caption-md-regular text-secondary">
            Tints the glass and changes buttons, links, selected items, and focus rings. The wallpaper stays unchanged.
          </p>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)]">
          <div className="min-w-0 space-y-3">
            <div className="text-caption-md-medium text-secondary">Color presets</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="GTS Glass color presets">
              {GTS_GLASS_ACCENT_PRESETS.map((preset) => {
                const isSelected = normalizedAccentColor === preset.value;

                return (
                  <button
                    key={preset.value}
                    type="button"
                    className={cn(
                      "group focus-visible:ring-accent-primary/30 flex min-w-20 items-center gap-2 rounded-md border px-2.5 py-2 text-caption-md-medium transition-all outline-none focus-visible:ring-2",
                      isSelected
                        ? "border-accent-strong bg-accent-subtle text-primary"
                        : "border-subtle bg-layer-2 text-secondary hover:border-strong hover:text-primary"
                    )}
                    aria-label={`Use ${preset.label} theme color`}
                    aria-pressed={isSelected}
                    onClick={() => setAccentColor(preset.value)}
                  >
                    <span
                      className="shadow-sm grid size-5 shrink-0 place-items-center rounded-full border border-white/20"
                      style={{ backgroundColor: preset.value }}
                    >
                      {isSelected && (
                        <Check className="size-3 text-[#021326] drop-shadow-[0_1px_1px_rgb(255_255_255/0.5)]" />
                      )}
                    </span>
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-subtle bg-layer-2 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-caption-md-medium text-primary">Custom color</div>
                <div className="mt-0.5 text-caption-sm-regular text-tertiary">
                  Preview updates instantly. Apply to save.
                </div>
              </div>
              <span
                className="size-8 shrink-0 rounded-md border border-white/20 shadow-raised-100"
                style={{ backgroundColor: normalizedAccentColor }}
                aria-hidden="true"
              />
            </div>
            <InputColorPicker
              name="gts-glass-accent-color"
              value={accentColor}
              onChange={handleAccentChange}
              placeholder={GTS_GLASS_DEFAULT_ACCENT}
              className="font-mono w-full bg-layer-1 text-primary placeholder:text-placeholder"
              hasError={!isAccentColorValid}
            />
            {!isAccentColorValid && (
              <p className="mt-1.5 text-caption-sm-regular text-danger-primary">
                Enter a valid 3- or 6-digit HEX color.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className="focus-visible:ring-accent-primary/30 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1.5 text-caption-md-medium text-secondary transition-colors outline-none hover:bg-layer-transparent-hover hover:text-primary focus-visible:ring-2 sm:self-auto"
            onClick={() => setAccentColor(GTS_GLASS_DEFAULT_ACCENT)}
          >
            <RotateCcw className="size-3.5" />
            Reset to Cyan
          </button>
          <Button
            variant="primary"
            size="lg"
            disabled={!isAccentDirty || !isAccentColorValid}
            onClick={() => void handleAccentSave()}
          >
            Apply color
          </Button>
        </div>
      </section>

      <section className="gts-glass-opacity-settings overflow-hidden rounded-lg border border-subtle bg-layer-1">
        <div className="flex flex-col gap-1 border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-body-sm-medium text-primary">
            <SlidersHorizontal className="size-4 text-accent-primary" />
            Glass transparency
          </div>
          <p className="text-caption-md-regular text-secondary">
            Control the main interface separately from task cards and rows. Higher values make surfaces more solid.
          </p>
        </div>

        <div className="grid gap-5 p-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-2" htmlFor="gts-glass-workspace-opacity">
            <span className="flex items-center justify-between gap-4 text-caption-md-medium text-secondary">
              Main window
              <span className="font-mono text-primary">{workspaceOpacity}%</span>
            </span>
            <input
              id="gts-glass-workspace-opacity"
              type="range"
              min={GTS_GLASS_MIN_WORKSPACE_OPACITY}
              max={GTS_GLASS_MAX_WORKSPACE_OPACITY}
              step={1}
              value={workspaceOpacity}
              className="accent-accent-primary h-1.5 w-full cursor-pointer"
              onChange={(event) => setWorkspaceOpacity(Number(event.target.value))}
            />
            <span className="text-caption-sm-regular text-tertiary">
              Workspace, navigation, headers, and view surfaces.
            </span>
          </label>

          <label className="flex min-w-0 flex-col gap-2" htmlFor="gts-glass-task-opacity">
            <span className="flex items-center justify-between gap-4 text-caption-md-medium text-secondary">
              Task cards and rows
              <span className="font-mono text-primary">{taskOpacity}%</span>
            </span>
            <input
              id="gts-glass-task-opacity"
              type="range"
              min={GTS_GLASS_MIN_TASK_OPACITY}
              max={GTS_GLASS_MAX_TASK_OPACITY}
              step={1}
              value={taskOpacity}
              className="accent-accent-primary h-1.5 w-full cursor-pointer"
              onChange={(event) => setTaskOpacity(Number(event.target.value))}
            />
            <span className="text-caption-sm-regular text-tertiary">
              Kanban cards plus List, Custom grouping, and Spreadsheet rows.
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3 border-t border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className="focus-visible:ring-accent-primary/30 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1.5 text-caption-md-medium text-secondary transition-colors outline-none hover:bg-layer-transparent-hover hover:text-primary focus-visible:ring-2 sm:self-auto"
            onClick={() => {
              setWorkspaceOpacity(GTS_GLASS_DEFAULT_WORKSPACE_OPACITY);
              setTaskOpacity(GTS_GLASS_DEFAULT_TASK_OPACITY);
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset transparency
          </button>
          <Button variant="primary" size="lg" disabled={!isOpacityDirty} onClick={() => void handleOpacitySave()}>
            Apply transparency
          </Button>
        </div>
      </section>

      <section className="gts-glass-background-settings overflow-hidden rounded-lg border border-subtle bg-layer-1">
        <div className="flex flex-col gap-1 border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2 text-body-sm-medium text-primary">
            <ImageIcon className="size-4 text-accent-primary" />
            Glass background
          </div>
          <p className="text-caption-md-regular text-secondary">
            Pick the image behind the interface. Blur is applied to surfaces, not to your image.
          </p>
        </div>

        <input
          ref={backgroundFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            handleBackgroundFileChange(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <button
            type="button"
            className={cn(
              "group focus-visible:ring-accent-primary/30 overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:border-accent-strong focus-visible:ring-2",
              background === "gts-tasks"
                ? "border-accent-strong bg-accent-subtle"
                : "border-subtle bg-layer-2 hover:border-strong"
            )}
            aria-pressed={background === "gts-tasks"}
            onClick={() => setBackground("gts-tasks")}
          >
            <div className="relative aspect-video overflow-hidden bg-[#021326]">
              <img src={gtsTasksWallpaper} alt="" className="size-full object-cover object-center" />
              <div className="absolute inset-0 bg-[#021326]/20" />
              {background === "gts-tasks" && (
                <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color shadow-raised-100">
                  <Check className="size-4" />
                </span>
              )}
            </div>
            <div className="space-y-1 p-3">
              <div className="text-body-xs-medium text-primary">Airport Sunset</div>
              <div className="text-caption-sm-regular leading-4 text-tertiary">Built-in airport background.</div>
            </div>
          </button>

          <button
            type="button"
            className={cn(
              "group focus-visible:ring-accent-primary/30 overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:border-accent-strong focus-visible:ring-2",
              background === "none"
                ? "border-accent-strong bg-accent-subtle"
                : "border-subtle bg-layer-2 hover:border-strong"
            )}
            aria-pressed={background === "none"}
            onClick={() => setBackground("none")}
          >
            <div className="relative grid aspect-video place-items-center overflow-hidden bg-[linear-gradient(145deg,#021326,#082640)]">
              <Moon className="size-6 text-secondary" />
              {background === "none" && (
                <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color shadow-raised-100">
                  <Check className="size-4" />
                </span>
              )}
            </div>
            <div className="space-y-1 p-3">
              <div className="text-body-xs-medium text-primary">No background</div>
              <div className="text-caption-sm-regular leading-4 text-tertiary">Use a clean solid glass canvas.</div>
            </div>
          </button>

          <div
            className={cn(
              "overflow-hidden rounded-lg border transition-colors",
              background === "custom"
                ? "border-accent-strong bg-accent-subtle"
                : "border-subtle bg-layer-2 hover:border-strong"
            )}
          >
            <button
              type="button"
              className="focus-visible:ring-accent-primary/30 relative block aspect-video w-full overflow-hidden bg-[#021326] outline-none focus-visible:ring-2"
              aria-pressed={background === "custom"}
              aria-label={customBackgroundPreview ? "Select your image" : "Upload your image"}
              onClick={() =>
                customBackgroundPreview ? setBackground("custom") : backgroundFileInputRef.current?.click()
              }
            >
              {customBackgroundPreview ? (
                <img src={customBackgroundPreview} alt="" className="size-full object-cover object-center" />
              ) : (
                <span className="grid size-full place-items-center border-2 border-dashed border-subtle bg-layer-1">
                  <ImagePlus className="size-7 text-secondary" />
                </span>
              )}
              {background === "custom" && (
                <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color shadow-raised-100">
                  <Check className="size-4" />
                </span>
              )}
            </button>
            <div className="flex min-h-16 items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <div className="text-body-xs-medium text-primary">Your image</div>
                <div className="text-caption-sm-regular leading-4 text-tertiary">
                  {customBackgroundPreview ? "Personal background." : "JPEG, PNG, or WebP."}
                </div>
              </div>
              <button
                type="button"
                className="focus-visible:ring-accent-primary/30 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption-sm-medium text-accent-primary outline-none hover:bg-accent-subtle focus-visible:ring-2"
                onClick={() => backgroundFileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {customBackgroundPreview ? "Replace" : "Upload"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-subtle px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex min-w-0 flex-1 flex-col gap-2" htmlFor="gts-glass-overlay-opacity">
            <span className="flex items-center justify-between gap-4 text-caption-md-medium text-secondary">
              Background dimming
              <span className="font-mono text-primary">{overlayOpacity}%</span>
            </span>
            <input
              id="gts-glass-overlay-opacity"
              type="range"
              min={42}
              max={58}
              step={1}
              value={overlayOpacity}
              className="accent-accent-primary h-1.5 w-full cursor-pointer"
              onChange={(event) => setOverlayOpacity(Number(event.target.value))}
            />
          </label>
          <Button
            variant="primary"
            size="lg"
            disabled={!isBackgroundDirty}
            loading={isBackgroundUploading}
            onClick={() => void handleBackgroundSave()}
          >
            Apply background
          </Button>
        </div>
      </section>
    </div>
  );
});
