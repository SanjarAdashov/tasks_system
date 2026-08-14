/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import { Check, ImageIcon, ImagePlus, Moon, Palette, Telescope, Upload, Users } from "lucide-react";
// plane imports
import { GTS_GLASS_THEME, THEME_OPTIONS } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, IInstance, IInstanceAdmin, IInstanceThemeSettings } from "@plane/types";
import { AlertModalCore, EModalWidth, Input, InputColorPicker, ToggleSwitch } from "@plane/ui";
import { cn, getFileURL, normalizeHexColor, validateHexColor } from "@plane/utils";
// assets
import gtsTasksWallpaper from "@/app/assets/backgrounds/gts-tasks-airport-sunset.png?url";
// components
import { ControllerInput } from "@/components/common/controller-input";
// hooks
import { useInstance } from "@/hooks/store";

export interface IGeneralConfigurationForm {
  instance: IInstance;
  instanceAdmins: IInstanceAdmin[];
  instanceConfig: IFormattedInstanceConfiguration;
}

type TGlassBackground = IInstanceThemeSettings["glass_background"];

const GTS_GLASS_DEFAULT_ACCENT = "#19A7F6";
const GTS_GLASS_ACCENT_PRESETS = [
  { label: "Cyan", value: GTS_GLASS_DEFAULT_ACCENT },
  { label: "Azure", value: "#4F8CFF" },
  { label: "Violet", value: "#8B7CFF" },
  { label: "Orchid", value: "#C86BFA" },
  { label: "Coral", value: "#FF786B" },
  { label: "Amber", value: "#F6B94A" },
  { label: "Emerald", value: "#2CD6A3" },
] as const;

const normalizeAccentColor = (value: string | undefined) =>
  value && validateHexColor(value) ? `#${normalizeHexColor(value)}` : GTS_GLASS_DEFAULT_ACCENT;

const normalizeGlassBackground = (value: string | undefined): TGlassBackground =>
  value === "custom" || value === "none" ? value : "gts-tasks";

export const GeneralConfigurationForm = observer(function GeneralConfigurationForm(props: IGeneralConfigurationForm) {
  const { instance, instanceAdmins, instanceConfig } = props;
  const { updateInstanceInfo, updateInstanceConfigurations, uploadInterfaceThemeBackground, applyInterfaceThemeToAll } =
    useInstance();
  const [defaultTheme, setDefaultTheme] = useState(instanceConfig.DEFAULT_INTERFACE_THEME || "dark");
  const [accentColor, setAccentColor] = useState(normalizeAccentColor(instanceConfig.DEFAULT_GLASS_ACCENT_COLOR));
  const [background, setBackground] = useState<TGlassBackground>(
    normalizeGlassBackground(instanceConfig.DEFAULT_GLASS_BACKGROUND)
  );
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState(instanceConfig.DEFAULT_GLASS_BACKGROUND_URL || "");
  const [overlayOpacity, setOverlayOpacity] = useState(Number(instanceConfig.DEFAULT_GLASS_OVERLAY_OPACITY) || 46);
  const [pendingBackgroundFile, setPendingBackgroundFile] = useState<File | null>(null);
  const [pendingBackgroundPreview, setPendingBackgroundPreview] = useState("");
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isApplyingTheme, setIsApplyingTheme] = useState(false);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDefaultTheme(instanceConfig.DEFAULT_INTERFACE_THEME || "dark");
    setAccentColor(normalizeAccentColor(instanceConfig.DEFAULT_GLASS_ACCENT_COLOR));
    setBackground(normalizeGlassBackground(instanceConfig.DEFAULT_GLASS_BACKGROUND));
    setCustomBackgroundUrl(instanceConfig.DEFAULT_GLASS_BACKGROUND_URL || "");
    setOverlayOpacity(Number(instanceConfig.DEFAULT_GLASS_OVERLAY_OPACITY) || 46);
  }, [
    instanceConfig.DEFAULT_GLASS_ACCENT_COLOR,
    instanceConfig.DEFAULT_GLASS_BACKGROUND,
    instanceConfig.DEFAULT_GLASS_BACKGROUND_URL,
    instanceConfig.DEFAULT_GLASS_OVERLAY_OPACITY,
    instanceConfig.DEFAULT_INTERFACE_THEME,
  ]);

  useEffect(
    () => () => {
      if (pendingBackgroundPreview) URL.revokeObjectURL(pendingBackgroundPreview);
    },
    [pendingBackgroundPreview]
  );

  const normalizedAccentColor = normalizeAccentColor(accentColor);
  const isAccentColorValid = validateHexColor(accentColor);
  const customBackgroundPreview = pendingBackgroundPreview || getFileURL(customBackgroundUrl) || customBackgroundUrl;
  const canPersistTheme =
    isAccentColorValid && (background !== "custom" || !!pendingBackgroundFile || !!customBackgroundUrl);

  const {
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Partial<IInstance>>({
    defaultValues: {
      instance_name: instance?.instance_name,
      is_telemetry_enabled: instance?.is_telemetry_enabled,
    },
  });

  const resolveThemeSettings = async (): Promise<IInstanceThemeSettings> => {
    if (!canPersistTheme) throw new Error("Complete the interface theme settings.");

    let nextBackgroundUrl = customBackgroundUrl;
    if (background === "custom" && pendingBackgroundFile) {
      const uploadResult = await uploadInterfaceThemeBackground(pendingBackgroundFile);
      nextBackgroundUrl = uploadResult.asset_url;
      setCustomBackgroundUrl(nextBackgroundUrl);
      setPendingBackgroundFile(null);
      setPendingBackgroundPreview("");
    }
    if (background !== "custom") nextBackgroundUrl = "";

    return {
      theme: defaultTheme,
      glass_accent_color: normalizedAccentColor,
      glass_background: background,
      glass_background_url: nextBackgroundUrl,
      glass_overlay_opacity: Math.min(58, Math.max(42, overlayOpacity)),
    };
  };

  const toConfigurationPayload = (settings: IInstanceThemeSettings) => ({
    DEFAULT_INTERFACE_THEME: settings.theme,
    DEFAULT_GLASS_ACCENT_COLOR: settings.glass_accent_color,
    DEFAULT_GLASS_BACKGROUND: settings.glass_background,
    DEFAULT_GLASS_BACKGROUND_URL: settings.glass_background_url,
    DEFAULT_GLASS_OVERLAY_OPACITY: String(settings.glass_overlay_opacity),
  });

  const onSubmit = async (formData: Partial<IInstance>) => {
    try {
      const settings = await resolveThemeSettings();
      await Promise.all([
        updateInstanceInfo({ ...formData }),
        updateInstanceConfigurations(toConfigurationPayload(settings)),
      ]);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success",
        message: "Settings updated successfully",
      });
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not save settings",
        message: "Check the interface theme values and try again.",
      });
    }
  };

  const handleApplyThemeToAll = async () => {
    setIsApplyingTheme(true);
    try {
      const settings = await resolveThemeSettings();
      const response = await applyInterfaceThemeToAll(settings);
      setIsApplyModalOpen(false);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Тема применена",
        message: `Настройки обновлены для ${response.updated_count} пользователей.`,
      });
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось применить тему",
        message: "Проверьте настройки оформления и повторите попытку.",
      });
    } finally {
      setIsApplyingTheme(false);
    }
  };

  const handleAccentChange = (value: string) => {
    const nextValue = value.trim();
    setAccentColor(nextValue && !nextValue.startsWith("#") ? `#${nextValue.toUpperCase()}` : nextValue.toUpperCase());
  };

  const handleBackgroundFileChange = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
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

  const selectedThemeLabel = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === defaultTheme)?.i18n_label || defaultTheme,
    [defaultTheme]
  );

  return (
    <>
      <AlertModalCore
        isOpen={isApplyModalOpen}
        handleClose={() => setIsApplyModalOpen(false)}
        handleSubmit={() => void handleApplyThemeToAll()}
        isSubmitting={isApplyingTheme}
        title="Применить тему ко всем пользователям?"
        content={`Тема «${selectedThemeLabel}», акцентный цвет и фон заменят текущие настройки всех существующих пользователей. После этого пользователи смогут изменить оформление в своем профиле.`}
        primaryButtonText={{
          default: "Применить ко всем",
          loading: "Применение",
        }}
        secondaryButtonText="Отмена"
        variant="primary"
        width={EModalWidth.LG}
        customIcon={<Users className="size-5" />}
      />

      <div className="space-y-8">
        <div className="space-y-4">
          <div className="text-16 font-medium text-primary">Instance details</div>
          <div className="grid-col grid w-full grid-cols-1 items-center justify-between gap-8 md:grid-cols-2 lg:grid-cols-3">
            <ControllerInput
              key="instance_name"
              name="instance_name"
              control={control}
              type="text"
              label="Name of instance"
              placeholder="Instance name"
              error={Boolean(errors.instance_name)}
              required
            />

            <div className="flex flex-col gap-1">
              <h4 className="text-13 text-tertiary">Email</h4>
              <Input
                id="email"
                name="email"
                type="email"
                value={instanceAdmins[0]?.user_detail?.email ?? ""}
                placeholder="Admin email"
                className="w-full cursor-not-allowed !text-placeholder"
                autoComplete="on"
                disabled
              />
            </div>

            <div className="flex flex-col gap-1">
              <h4 className="text-13 text-tertiary">Instance ID</h4>
              <Input
                id="instance_id"
                name="instance_id"
                type="text"
                value={instance.instance_id}
                className="w-full cursor-not-allowed rounded-md font-medium !text-placeholder"
                disabled
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border-b border-subtle pb-1.5 text-16 font-medium text-primary">Telemetry</div>
          <div className="flex items-center gap-14">
            <div className="flex grow items-center gap-4">
              <div className="shrink-0">
                <div className="flex size-11 items-center justify-center rounded-lg bg-layer-1">
                  <Telescope className="size-5 text-tertiary" />
                </div>
              </div>
              <div className="grow">
                <div className="text-13 leading-5 font-medium text-primary">Let Plane collect anonymous usage data</div>
                <div className="text-11 leading-5 font-regular text-tertiary">
                  No PII is collected. This anonymized data helps improve the product.
                </div>
              </div>
            </div>
            <div className={`shrink-0 ${isSubmitting ? "opacity-70" : ""}`}>
              <Controller
                control={control}
                name="is_telemetry_enabled"
                render={({ field: { value, onChange } }) => (
                  <ToggleSwitch value={value ?? false} onChange={onChange} size="sm" disabled={isSubmitting} />
                )}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-b border-subtle pb-1.5 text-16 font-medium text-primary">Interface defaults</div>
          <div className="overflow-hidden rounded-xl border border-subtle bg-layer-1">
            <div className="flex flex-col gap-4 border-b border-subtle p-4 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl space-y-1">
                <div className="text-13 leading-5 font-medium text-primary">Default theme for users</div>
                <div className="text-11 leading-5 font-regular text-tertiary">
                  New users inherit this theme. Existing users are updated only when you use the apply-to-all action.
                </div>
              </div>
              <select
                value={defaultTheme}
                className="h-9 min-w-52 rounded-md border border-subtle-1 bg-surface-1 px-3 text-13 text-primary outline-none focus:border-accent-strong"
                onChange={(event) => setDefaultTheme(event.target.value)}
              >
                {THEME_OPTIONS.filter((option) =>
                  ["light", "dark", "light-contrast", "dark-contrast", GTS_GLASS_THEME].includes(option.value)
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.i18n_label}
                  </option>
                ))}
              </select>
            </div>

            {defaultTheme === GTS_GLASS_THEME && (
              <div className="space-y-6 p-4">
                <section className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
                      <Palette className="size-4" />
                    </span>
                    <div>
                      <div className="text-13 font-medium text-primary">Accent color</div>
                      <div className="text-11 leading-5 text-tertiary">
                        Sets buttons, links, selected items, focus rings, and the glass tint.
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                    <div className="flex flex-wrap gap-2">
                      {GTS_GLASS_ACCENT_PRESETS.map((preset) => {
                        const isSelected = normalizedAccentColor === preset.value;
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            className={cn(
                              "focus-visible:ring-accent-primary/30 flex min-w-20 items-center gap-2 rounded-md border px-2.5 py-2 text-11 font-medium transition-colors outline-none focus-visible:ring-2",
                              isSelected
                                ? "border-accent-strong bg-accent-subtle text-primary"
                                : "border-subtle bg-layer-2 text-secondary hover:border-strong hover:text-primary"
                            )}
                            aria-pressed={isSelected}
                            onClick={() => setAccentColor(preset.value)}
                          >
                            <span
                              className="grid size-5 place-items-center rounded-full border border-white/20"
                              style={{ backgroundColor: preset.value }}
                            >
                              {isSelected && <Check className="size-3 text-[#021326]" />}
                            </span>
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <div>
                      <InputColorPicker
                        name="instance-glass-accent-color"
                        value={accentColor}
                        onChange={handleAccentChange}
                        placeholder={GTS_GLASS_DEFAULT_ACCENT}
                        className="font-mono w-full bg-layer-2 text-primary"
                        hasError={!isAccentColorValid}
                      />
                      {!isAccentColorValid && (
                        <p className="mt-1 text-11 text-danger-primary">Enter a valid 6-digit HEX color.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-3 border-t border-subtle pt-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
                      <ImageIcon className="size-4" />
                    </span>
                    <div>
                      <div className="text-13 font-medium text-primary">Background</div>
                      <div className="text-11 leading-5 text-tertiary">
                        Choose the image shown behind GTS Glass for users who inherit the instance theme.
                      </div>
                    </div>
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

                  <div className="grid gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      className={cn(
                        "focus-visible:ring-accent-primary/30 overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-2",
                        background === "gts-tasks"
                          ? "border-accent-strong bg-accent-subtle"
                          : "border-subtle bg-layer-2 hover:border-strong"
                      )}
                      aria-pressed={background === "gts-tasks"}
                      onClick={() => setBackground("gts-tasks")}
                    >
                      <div className="relative aspect-video overflow-hidden bg-[#021326]">
                        <img src={gtsTasksWallpaper} alt="" className="size-full object-cover" />
                        {background === "gts-tasks" && (
                          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color">
                            <Check className="size-4" />
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="text-12 font-medium text-primary">Airport Sunset</div>
                        <div className="mt-1 text-11 text-tertiary">Built-in background</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "focus-visible:ring-accent-primary/30 overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-2",
                        background === "none"
                          ? "border-accent-strong bg-accent-subtle"
                          : "border-subtle bg-layer-2 hover:border-strong"
                      )}
                      aria-pressed={background === "none"}
                      onClick={() => setBackground("none")}
                    >
                      <div className="relative grid aspect-video place-items-center bg-[linear-gradient(145deg,#021326,#082640)]">
                        <Moon className="size-6 text-secondary" />
                        {background === "none" && (
                          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color">
                            <Check className="size-4" />
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="text-12 font-medium text-primary">No background</div>
                        <div className="mt-1 text-11 text-tertiary">Solid glass canvas</div>
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
                        onClick={() =>
                          customBackgroundPreview ? setBackground("custom") : backgroundFileInputRef.current?.click()
                        }
                      >
                        {customBackgroundPreview ? (
                          <img src={customBackgroundPreview} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="grid size-full place-items-center border-2 border-dashed border-subtle">
                            <ImagePlus className="size-7 text-secondary" />
                          </span>
                        )}
                        {background === "custom" && (
                          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-md bg-accent-primary text-on-color">
                            <Check className="size-4" />
                          </span>
                        )}
                      </button>
                      <div className="flex min-h-16 items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <div className="text-12 font-medium text-primary">Custom image</div>
                          <div className="mt-1 text-11 text-tertiary">JPEG, PNG, or WebP</div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-11 font-medium text-accent-primary hover:bg-accent-subtle"
                          onClick={() => backgroundFileInputRef.current?.click()}
                        >
                          <Upload className="size-3.5" />
                          {customBackgroundPreview ? "Replace" : "Upload"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <label className="flex max-w-lg flex-col gap-2" htmlFor="instance-glass-overlay-opacity">
                    <span className="flex items-center justify-between text-11 font-medium text-secondary">
                      Background dimming
                      <span className="font-mono text-primary">{overlayOpacity}%</span>
                    </span>
                    <input
                      id="instance-glass-overlay-opacity"
                      type="range"
                      min={42}
                      max={58}
                      step={1}
                      value={overlayOpacity}
                      className="accent-accent-primary h-1.5 w-full cursor-pointer"
                      onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                    />
                  </label>
                </section>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-subtle bg-layer-1 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-primary">
                <Users className="size-5" />
              </span>
              <div className="max-w-2xl">
                <div className="text-13 font-medium text-primary">Apply the selected appearance to existing users</div>
                <div className="mt-1 text-11 leading-5 text-tertiary">
                  This replaces each user&apos;s current theme, accent, and background. Confirmation is required.
                </div>
              </div>
            </div>
            <Button variant="secondary" size="lg" disabled={!canPersistTheme} onClick={() => setIsApplyModalOpen(true)}>
              Применить тему ко всем пользователям
            </Button>
          </div>
        </div>

        <div>
          <Button
            variant="primary"
            size="lg"
            disabled={!canPersistTheme}
            onClick={() => void handleSubmit(onSubmit)()}
            loading={isSubmitting}
          >
            {isSubmitting ? "Saving" : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
});
