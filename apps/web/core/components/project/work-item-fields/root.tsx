/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectWorkItemProperty, TWorkItemBuiltInFieldKey, TWorkItemBuiltInFieldSettings } from "@plane/types";
import { Button, Loader, ToggleSwitch } from "@plane/ui";
import { ProjectService } from "@/services/project";
import {
  BUILT_IN_FIELD_LABELS,
  BUILT_IN_FIELD_ORDER,
  HIDEABLE_BUILT_IN_FIELDS,
  PROPERTY_TYPE_LABELS,
} from "./constants";
import { WorkItemPropertyForm } from "./property-form";

const SYSTEM_FIELD_LOADER_KEYS = ["system-1", "system-2", "system-3", "system-4", "system-5", "system-6"];
const PROPERTY_LOADER_KEYS = ["property-1", "property-2", "property-3"];

type Props = {
  workspaceSlug: string;
  projectId: string;
};

const formatError = (error: unknown, fallback: string): string => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const firstValue = Object.values(error)[0];
  if (typeof firstValue === "string") return firstValue;
  if (Array.isArray(firstValue) && typeof firstValue[0] === "string") return firstValue[0];
  return fallback;
};

export function WorkItemFieldsSettings({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const configurationKey = `WORK_ITEM_FIELD_CONFIGURATION_${workspaceSlug}_${projectId}`;
  const propertiesKey = `WORK_ITEM_PROPERTIES_${workspaceSlug}_${projectId}`;

  const {
    data: configuration,
    isLoading: isConfigurationLoading,
    mutate: mutateConfiguration,
  } = useSWR(configurationKey, () => service.getWorkItemFieldConfiguration(workspaceSlug, projectId));
  const {
    data: properties,
    isLoading: arePropertiesLoading,
    mutate: mutateProperties,
  } = useSWR(propertiesKey, () => service.getWorkItemProperties(workspaceSlug, projectId));

  const [builtInFields, setBuiltInFields] = useState<
    Partial<Record<TWorkItemBuiltInFieldKey, TWorkItemBuiltInFieldSettings>>
  >({});
  const [isSavingConfiguration, setIsSavingConfiguration] = useState(false);
  const [editingProperty, setEditingProperty] = useState<TProjectWorkItemProperty | null>(null);
  const [isCreatingProperty, setIsCreatingProperty] = useState(false);
  const [archivingPropertyId, setArchivingPropertyId] = useState<string | null>(null);

  useEffect(() => {
    if (!configuration) return;
    setBuiltInFields(structuredClone(configuration.built_in_fields));
  }, [configuration]);

  const updateBuiltInField = (fieldKey: TWorkItemBuiltInFieldKey, changes: Partial<TWorkItemBuiltInFieldSettings>) => {
    setBuiltInFields((current) => {
      const currentSettings = current[fieldKey];
      if (!currentSettings) return current;
      const nextSettings = { ...currentSettings, ...changes };
      if (!nextSettings.visible) nextSettings.required = false;
      return { ...current, [fieldKey]: nextSettings };
    });
  };

  const saveBuiltInFields = async () => {
    if (!configuration) return;
    setIsSavingConfiguration(true);
    try {
      const savedConfiguration = await service.updateWorkItemFieldConfiguration(workspaceSlug, projectId, {
        built_in_fields: builtInFields as typeof configuration.built_in_fields,
      });
      await mutateConfiguration(savedConfiguration, { revalidate: false });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_settings.work_item_fields.system_fields.toast.success_title"),
        message: t("project_settings.work_item_fields.system_fields.toast.success_message"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.work_item_fields.system_fields.toast.error_title"),
        message: formatError(error, t("project_settings.work_item_fields.errors.try_again")),
      });
    } finally {
      setIsSavingConfiguration(false);
    }
  };

  const archiveProperty = async (property: TProjectWorkItemProperty) => {
    if (
      !window.confirm(t("project_settings.work_item_fields.custom_properties.archive_confirm", { name: property.name }))
    )
      return;
    setArchivingPropertyId(property.id);
    try {
      await service.archiveWorkItemProperty(workspaceSlug, projectId, property.id);
      await mutateProperties((current) => current?.filter((item) => item.id !== property.id), { revalidate: false });
      if (editingProperty?.id === property.id) setEditingProperty(null);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_settings.work_item_fields.custom_properties.toast.archived_title"),
        message: t("project_settings.work_item_fields.custom_properties.toast.archived_message"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.work_item_fields.custom_properties.toast.archive_error_title"),
        message: formatError(error, t("project_settings.work_item_fields.errors.try_again")),
      });
    } finally {
      setArchivingPropertyId(null);
    }
  };

  const handleSavedProperty = async (savedProperty: TProjectWorkItemProperty) => {
    await mutateProperties(
      (current) => {
        const existing = current ?? [];
        const index = existing.findIndex((item) => item.id === savedProperty.id);
        if (index === -1) return [...existing, savedProperty];
        return existing.map((item) => (item.id === savedProperty.id ? savedProperty : item));
      },
      { revalidate: false }
    );
    setEditingProperty(null);
    setIsCreatingProperty(false);
  };

  return (
    <div className="flex flex-col gap-8 pb-12">
      <section>
        <div className="mb-3">
          <h3 className="text-15 font-semibold text-primary">
            {t("project_settings.work_item_fields.system_fields.title")}
          </h3>
          <p className="mt-1 text-12 text-tertiary">
            {t("project_settings.work_item_fields.system_fields.description")}
          </p>
        </div>

        {isConfigurationLoading || !configuration ? (
          <Loader className="flex flex-col gap-2">
            {SYSTEM_FIELD_LOADER_KEYS.map((key) => (
              <Loader.Item key={key} height="44px" width="100%" />
            ))}
          </Loader>
        ) : (
          <div className="overflow-hidden rounded-lg border border-subtle">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] border-b border-subtle bg-surface-2 px-4 py-2 text-11 font-medium text-tertiary uppercase">
              <span>{t("project_settings.work_item_fields.system_fields.columns.field")}</span>
              <span className="text-center">
                {t("project_settings.work_item_fields.system_fields.columns.visible")}
              </span>
              <span className="text-center">
                {t("project_settings.work_item_fields.system_fields.columns.required")}
              </span>
            </div>
            {BUILT_IN_FIELD_ORDER.map((fieldKey) => {
              const settings = builtInFields[fieldKey];
              if (!settings) return null;
              const canHide = HIDEABLE_BUILT_IN_FIELDS.has(fieldKey);
              const isLockedRequired = fieldKey === "project" || fieldKey === "title";

              return (
                <div
                  key={fieldKey}
                  className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center border-b border-subtle px-4 py-3 last:border-b-0"
                >
                  <span className="text-13 font-medium text-primary">{t(BUILT_IN_FIELD_LABELS[fieldKey])}</span>
                  <div className="flex justify-center">
                    {canHide ? (
                      <ToggleSwitch
                        value={settings.visible}
                        onChange={(visible) => updateBuiltInField(fieldKey, { visible })}
                      />
                    ) : (
                      <span className="text-11 text-tertiary">
                        {t("project_settings.work_item_fields.system_fields.always")}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <ToggleSwitch
                      value={settings.required}
                      disabled={!settings.visible || isLockedRequired}
                      onChange={(required) => updateBuiltInField(fieldKey, { required })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button
            onClick={saveBuiltInFields}
            loading={isSavingConfiguration}
            disabled={isConfigurationLoading || !configuration}
          >
            {t("project_settings.work_item_fields.system_fields.save")}
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-15 font-semibold text-primary">
              {t("project_settings.work_item_fields.custom_properties.title")}
            </h3>
            <p className="mt-1 text-12 text-tertiary">
              {t("project_settings.work_item_fields.custom_properties.description")}
            </p>
          </div>
          <Button
            prependIcon={<Plus />}
            onClick={() => {
              setEditingProperty(null);
              setIsCreatingProperty(true);
            }}
            disabled={isCreatingProperty}
          >
            {t("project_settings.work_item_fields.custom_properties.new")}
          </Button>
        </div>

        {arePropertiesLoading ? (
          <Loader className="flex flex-col gap-2">
            {PROPERTY_LOADER_KEYS.map((key) => (
              <Loader.Item key={key} height="64px" width="100%" />
            ))}
          </Loader>
        ) : properties?.length ? (
          <div className="overflow-hidden rounded-lg border border-subtle">
            {properties.map((property) => (
              <div
                key={property.id}
                className="flex items-center justify-between gap-4 border-b border-subtle px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-13 font-medium text-primary">{property.name}</span>
                    {property.is_required && (
                      <span className="rounded bg-danger-subtle px-1.5 py-0.5 text-10 font-medium text-danger-primary">
                        {t("project_settings.work_item_fields.custom_properties.required_badge")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-11 text-tertiary">
                    {t(PROPERTY_TYPE_LABELS[property.property_type])}
                    {(property.property_type === "SINGLE_SELECT" || property.property_type === "MULTI_SELECT") &&
                    property.select_source === "MEMBERS"
                      ? ` · ${t("project_settings.work_item_fields.form.project_members")}`
                      : ""}
                    {property.description ? ` · ${property.description}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="link-neutral"
                    size="sm"
                    prependIcon={<Pencil />}
                    onClick={() => {
                      setIsCreatingProperty(false);
                      setEditingProperty(property);
                    }}
                  >
                    {t("project_settings.work_item_fields.custom_properties.edit")}
                  </Button>
                  <Button
                    variant="link-danger"
                    size="sm"
                    prependIcon={<Archive />}
                    loading={archivingPropertyId === property.id}
                    onClick={() => archiveProperty(property)}
                  >
                    {t("project_settings.work_item_fields.custom_properties.archive")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-subtle px-5 py-10 text-center">
            <div className="text-13 font-medium text-primary">
              {t("project_settings.work_item_fields.custom_properties.empty_title")}
            </div>
            <div className="mt-1 text-12 text-tertiary">
              {t("project_settings.work_item_fields.custom_properties.empty_description")}
            </div>
          </div>
        )}
      </section>

      {(isCreatingProperty || editingProperty) && (
        <WorkItemPropertyForm
          key={editingProperty?.id ?? "new"}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          property={editingProperty ?? undefined}
          onCancel={() => {
            setEditingProperty(null);
            setIsCreatingProperty(false);
          }}
          onSaved={handleSavedProperty}
        />
      )}
    </div>
  );
}
