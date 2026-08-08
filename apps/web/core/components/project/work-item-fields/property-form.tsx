/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TProjectWorkItemProperty,
  TProjectWorkItemPropertyPayload,
  TProjectWorkItemPropertyValue,
  TWorkItemSelectSource,
  TWorkItemPropertyType,
} from "@plane/types";
import { Button, Input, TextArea, ToggleSwitch } from "@plane/ui";
import { ProjectService } from "@/services/project";
import { WorkItemMultiSelectInput, WorkItemSingleSelectInput } from "@/components/issues/work-item-properties";
import { PROPERTY_TYPE_LABELS } from "./constants";

type TEditorOption = {
  id: string;
  name: string;
  sort_order: number;
  is_archived?: boolean;
  persisted: boolean;
};

type TEditorState = {
  name: string;
  description: string;
  property_type: TWorkItemPropertyType;
  select_source: TWorkItemSelectSource;
  is_required: boolean;
  has_default: boolean;
  default_value: TProjectWorkItemPropertyValue;
  options: TEditorOption[];
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  property?: TProjectWorkItemProperty;
  onCancel: () => void;
  onSaved: (property: TProjectWorkItemProperty) => void;
};

const SELECT_TYPES = new Set<TWorkItemPropertyType>(["SINGLE_SELECT", "MULTI_SELECT"]);

const createEmptyEditor = (): TEditorState => ({
  name: "",
  description: "",
  property_type: "SHORT_TEXT",
  select_source: "MANUAL",
  is_required: false,
  has_default: false,
  default_value: null,
  options: [],
});

const createEditorFromProperty = (property?: TProjectWorkItemProperty): TEditorState => {
  if (!property) return createEmptyEditor();

  return {
    name: property.name,
    description: property.description,
    property_type: property.property_type,
    select_source: property.select_source ?? "MANUAL",
    is_required: property.is_required,
    has_default: property.default_value !== null,
    default_value: property.default_value,
    options: property.options.map((option) => ({
      id: option.id,
      name: option.name,
      sort_order: option.sort_order,
      is_archived: option.archived_at !== null,
      persisted: true,
    })),
  };
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;

  const firstValue = Object.values(error)[0];
  if (typeof firstValue === "string") return firstValue;
  if (Array.isArray(firstValue) && typeof firstValue[0] === "string") return firstValue[0];
  if (firstValue && typeof firstValue === "object") return errorMessage(firstValue, fallback);
  return fallback;
};

export function WorkItemPropertyForm(props: Props) {
  const { workspaceSlug, projectId, property, onCancel, onSaved } = props;
  const { t } = useTranslation();
  const service = useMemo(() => new ProjectService(), []);
  const [editor, setEditor] = useState<TEditorState>(() => createEditorFromProperty(property));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOptions = editor.options.filter((option) => !option.is_archived);
  const isSelect = SELECT_TYPES.has(editor.property_type);
  const isMemberSelect = isSelect && editor.select_source === "MEMBERS";
  const requiresManualOptions = isSelect && !isMemberSelect;
  const hasValidOptions =
    !requiresManualOptions || (activeOptions.length > 0 && activeOptions.every((option) => option.name.trim()));
  const canSubmit = editor.name.trim().length > 0 && hasValidOptions;

  const updateType = (propertyType: TWorkItemPropertyType) => {
    setEditor((current) => ({
      ...current,
      property_type: propertyType,
      select_source: SELECT_TYPES.has(propertyType) ? current.select_source : "MANUAL",
      has_default: false,
      default_value: null,
      options: SELECT_TYPES.has(propertyType) ? current.options : [],
    }));
  };

  const updateSelectSource = (source: TWorkItemSelectSource) => {
    setEditor((current) => ({
      ...current,
      select_source: source,
      has_default: false,
      default_value: null,
    }));
  };

  const addOption = () => {
    setEditor((current) => ({
      ...current,
      options: [
        ...current.options,
        {
          id: uuidv4(),
          name: "",
          sort_order: (current.options.length + 1) * 100,
          persisted: false,
        },
      ],
    }));
  };

  const updateOption = (id: string, name: string) => {
    setEditor((current) => ({
      ...current,
      options: current.options.map((option) => (option.id === id ? { ...option, name } : option)),
    }));
  };

  const removeOption = (id: string) => {
    setEditor((current) => {
      const option = current.options.find((item) => item.id === id);
      const options = option?.persisted
        ? current.options.map((item) => (item.id === id ? { ...item, is_archived: true } : item))
        : current.options.filter((item) => item.id !== id);

      let defaultValue = current.default_value;
      if (current.property_type === "SINGLE_SELECT" && defaultValue === id) defaultValue = null;
      if (current.property_type === "MULTI_SELECT" && Array.isArray(defaultValue)) {
        defaultValue = defaultValue.filter((optionId) => optionId !== id);
      }

      return {
        ...current,
        default_value: defaultValue,
        has_default:
          current.property_type === "MULTI_SELECT" && Array.isArray(defaultValue)
            ? defaultValue.length > 0
            : current.has_default && defaultValue !== null,
        options,
      };
    });
  };

  const normalizedDefaultValue = (): TProjectWorkItemPropertyValue => {
    if (!editor.has_default) return null;
    if (editor.property_type === "NUMBER") {
      const value = Number(editor.default_value);
      return Number.isFinite(value) ? value : null;
    }
    if (editor.property_type === "CHECKBOX") return Boolean(editor.default_value);
    if (editor.property_type === "MULTI_SELECT") {
      return Array.isArray(editor.default_value) ? editor.default_value : [];
    }
    return editor.default_value;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    const payload: TProjectWorkItemPropertyPayload = {
      name: editor.name.trim(),
      description: editor.description.trim(),
      property_type: editor.property_type,
      select_source: editor.select_source,
      is_required: editor.is_required,
      default_value: normalizedDefaultValue(),
      options: requiresManualOptions
        ? editor.options.map(({ id, name, sort_order, is_archived }) => ({
            id,
            name: name.trim(),
            sort_order,
            ...(is_archived ? { is_archived: true } : {}),
          }))
        : undefined,
    };

    try {
      const savedProperty = property
        ? await service.updateWorkItemProperty(workspaceSlug, projectId, property.id, payload)
        : await service.createWorkItemProperty(workspaceSlug, projectId, payload);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: property
          ? t("project_settings.work_item_fields.form.toast.updated_title")
          : t("project_settings.work_item_fields.form.toast.created_title"),
        message: t("project_settings.work_item_fields.form.toast.ready_message", { name: savedProperty.name }),
      });
      onSaved(savedProperty);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.work_item_fields.form.toast.error_title"),
        message: errorMessage(error, t("project_settings.work_item_fields.form.toast.error_message")),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDefaultInput = () => {
    if (!editor.has_default) return null;

    if (editor.property_type === "CHECKBOX") {
      return (
        <div className="flex items-center gap-3">
          <ToggleSwitch
            value={Boolean(editor.default_value)}
            onChange={(value) => setEditor((current) => ({ ...current, default_value: value }))}
          />
          <span className="text-13 text-secondary">
            {editor.default_value
              ? t("project_settings.work_item_fields.form.checked")
              : t("project_settings.work_item_fields.form.unchecked")}
          </span>
        </div>
      );
    }

    if (editor.property_type === "SINGLE_SELECT") {
      return (
        <WorkItemSingleSelectInput
          source={editor.select_source}
          projectId={projectId}
          manualOptions={activeOptions.map((option) => ({
            id: option.id,
            label: option.name || t("project_settings.work_item_fields.form.untitled_option"),
          }))}
          value={typeof editor.default_value === "string" ? editor.default_value : null}
          onChange={(defaultValue) => setEditor((current) => ({ ...current, default_value: defaultValue }))}
          placeholder={
            editor.select_source === "MEMBERS"
              ? t("project_settings.work_item_fields.form.select_member")
              : t("project_settings.work_item_fields.form.select_option")
          }
        />
      );
    }

    if (editor.property_type === "MULTI_SELECT") {
      const selectedValues = Array.isArray(editor.default_value) ? editor.default_value : [];
      return (
        <WorkItemMultiSelectInput
          source={editor.select_source}
          projectId={projectId}
          manualOptions={activeOptions.map((option) => ({
            id: option.id,
            label: option.name || t("project_settings.work_item_fields.form.untitled_option"),
          }))}
          value={selectedValues}
          onChange={(defaultValue) => setEditor((current) => ({ ...current, default_value: defaultValue }))}
          placeholder={
            editor.select_source === "MEMBERS"
              ? t("project_settings.work_item_fields.form.select_members")
              : t("project_settings.work_item_fields.form.select_options")
          }
        />
      );
    }

    if (editor.property_type === "LONG_TEXT") {
      return (
        <TextArea
          value={typeof editor.default_value === "string" ? editor.default_value : ""}
          onChange={(event) => setEditor((current) => ({ ...current, default_value: event.target.value }))}
          placeholder={t("project_settings.work_item_fields.form.default_value_placeholder")}
        />
      );
    }

    return (
      <Input
        className="w-full"
        type={editor.property_type === "NUMBER" ? "number" : editor.property_type === "DATE" ? "date" : "text"}
        value={
          typeof editor.default_value === "string" || typeof editor.default_value === "number"
            ? editor.default_value
            : ""
        }
        onChange={(event) => setEditor((current) => ({ ...current, default_value: event.target.value }))}
        placeholder={t("project_settings.work_item_fields.form.default_value_placeholder")}
      />
    );
  };

  return (
    <div className="rounded-lg border border-subtle bg-surface-1 p-5">
      <div className="mb-5">
        <h3 className="text-15 font-semibold text-primary">
          {property
            ? t("project_settings.work_item_fields.form.edit_title")
            : t("project_settings.work_item_fields.form.new_title")}
        </h3>
        <p className="mt-1 text-12 text-tertiary">{t("project_settings.work_item_fields.form.description")}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label htmlFor="work-item-property-name" className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          {t("project_settings.work_item_fields.form.name_label")}
          <Input
            id="work-item-property-name"
            value={editor.name}
            onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
            placeholder={t("project_settings.work_item_fields.form.name_placeholder")}
            hasError={!editor.name.trim()}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          {t("project_settings.work_item_fields.form.type_label")}
          <select
            className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            value={editor.property_type}
            disabled={Boolean(property)}
            onChange={(event) => updateType(event.target.value as TWorkItemPropertyType)}
          >
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, labelKey]) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isSelect && (
        <label className="mt-5 flex flex-col gap-1.5 text-12 font-medium text-secondary">
          {t("project_settings.work_item_fields.form.select_source_label")}
          <select
            className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            value={editor.select_source}
            disabled={Boolean(property)}
            onChange={(event) => updateSelectSource(event.target.value as TWorkItemSelectSource)}
          >
            <option value="MANUAL">{t("project_settings.work_item_fields.form.manual_list")}</option>
            <option value="MEMBERS">{t("project_settings.work_item_fields.form.project_members")}</option>
          </select>
          <span className="font-normal text-11 text-tertiary">
            {t("project_settings.work_item_fields.form.select_source_description")}
          </span>
        </label>
      )}

      <label
        htmlFor="work-item-property-description"
        className="mt-5 flex flex-col gap-1.5 text-12 font-medium text-secondary"
      >
        {t("project_settings.work_item_fields.form.description_label")}
        <TextArea
          id="work-item-property-description"
          value={editor.description}
          onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
          placeholder={t("project_settings.work_item_fields.form.description_placeholder")}
        />
      </label>

      <div className="mt-5 flex items-center justify-between rounded-md border border-subtle p-3">
        <div>
          <div className="text-13 font-medium text-primary">
            {t("project_settings.work_item_fields.form.required_title")}
          </div>
          <div className="text-11 text-tertiary">
            {t("project_settings.work_item_fields.form.required_description")}
          </div>
        </div>
        <ToggleSwitch
          value={editor.is_required}
          onChange={(value) => setEditor((current) => ({ ...current, is_required: value }))}
        />
      </div>

      {requiresManualOptions && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-13 font-medium text-primary">
                {t("project_settings.work_item_fields.form.options_title")}
              </div>
              <div className="text-11 text-tertiary">
                {t("project_settings.work_item_fields.form.options_description")}
              </div>
            </div>
            <Button variant="neutral-primary" size="sm" prependIcon={<Plus />} onClick={addOption}>
              {t("project_settings.work_item_fields.form.add_option")}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {activeOptions.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2">
                <Input
                  className="w-full"
                  value={option.name}
                  onChange={(event) => updateOption(option.id, event.target.value)}
                  placeholder={t("project_settings.work_item_fields.form.option_placeholder", {
                    number: index + 1,
                  })}
                  hasError={!option.name.trim()}
                />
                <button
                  type="button"
                  className="rounded p-2 text-tertiary hover:bg-surface-2 hover:text-danger-primary"
                  onClick={() => removeOption(option.id)}
                  aria-label={t("project_settings.work_item_fields.form.remove_option")}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {activeOptions.length === 0 && (
              <div className="rounded-md border border-dashed border-subtle px-3 py-4 text-center text-12 text-tertiary">
                {t("project_settings.work_item_fields.form.empty_options")}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-subtle p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-13 font-medium text-primary">
              {t("project_settings.work_item_fields.form.default_value_title")}
            </div>
            <div className="text-11 text-tertiary">
              {t("project_settings.work_item_fields.form.default_value_description")}
            </div>
          </div>
          <ToggleSwitch
            value={editor.has_default}
            disabled={requiresManualOptions && activeOptions.length === 0}
            onChange={(value) =>
              setEditor((current) => ({
                ...current,
                has_default: value,
                default_value:
                  value && current.property_type === "CHECKBOX"
                    ? false
                    : value && current.property_type === "MULTI_SELECT"
                      ? []
                      : value
                        ? ""
                        : null,
              }))
            }
          />
        </div>
        {editor.has_default && <div className="mt-3">{renderDefaultInput()}</div>}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral-primary" onClick={onCancel} disabled={isSubmitting}>
          {t("project_settings.work_item_fields.form.cancel")}
        </Button>
        <Button onClick={submit} loading={isSubmitting} disabled={!canSubmit}>
          {property
            ? t("project_settings.work_item_fields.form.save_changes")
            : t("project_settings.work_item_fields.form.create_property")}
        </Button>
      </div>
    </div>
  );
}
