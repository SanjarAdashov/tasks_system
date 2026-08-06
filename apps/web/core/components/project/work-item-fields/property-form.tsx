/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TProjectWorkItemProperty,
  TProjectWorkItemPropertyPayload,
  TProjectWorkItemPropertyValue,
  TWorkItemMultiSelectSource,
  TWorkItemPropertyType,
} from "@plane/types";
import { Button, Input, TextArea, ToggleSwitch } from "@plane/ui";
import { ProjectService } from "@/services/project";
import { WorkItemMultiSelectInput } from "@/components/issues/work-item-properties";
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
  multi_select_source: TWorkItemMultiSelectSource;
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
  multi_select_source: "MANUAL",
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
    multi_select_source: property.multi_select_source ?? "MANUAL",
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

const errorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "The property could not be saved.";

  const firstValue = Object.values(error)[0];
  if (typeof firstValue === "string") return firstValue;
  if (Array.isArray(firstValue) && typeof firstValue[0] === "string") return firstValue[0];
  if (firstValue && typeof firstValue === "object") return errorMessage(firstValue);
  return "The property could not be saved.";
};

export function WorkItemPropertyForm(props: Props) {
  const { workspaceSlug, projectId, property, onCancel, onSaved } = props;
  const service = useMemo(() => new ProjectService(), []);
  const [editor, setEditor] = useState<TEditorState>(() => createEditorFromProperty(property));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOptions = editor.options.filter((option) => !option.is_archived);
  const isSelect = SELECT_TYPES.has(editor.property_type);
  const isMemberMultiSelect = editor.property_type === "MULTI_SELECT" && editor.multi_select_source === "MEMBERS";
  const requiresManualOptions = isSelect && !isMemberMultiSelect;
  const hasValidOptions =
    !requiresManualOptions || (activeOptions.length > 0 && activeOptions.every((option) => option.name.trim()));
  const canSubmit = editor.name.trim().length > 0 && hasValidOptions;

  const updateType = (propertyType: TWorkItemPropertyType) => {
    setEditor((current) => ({
      ...current,
      property_type: propertyType,
      multi_select_source: propertyType === "MULTI_SELECT" ? current.multi_select_source : "MANUAL",
      has_default: false,
      default_value: null,
      options: SELECT_TYPES.has(propertyType) ? current.options : [],
    }));
  };

  const updateMultiSelectSource = (source: TWorkItemMultiSelectSource) => {
    setEditor((current) => ({
      ...current,
      multi_select_source: source,
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
          id: crypto.randomUUID(),
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
      multi_select_source: editor.multi_select_source,
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
        title: property ? "Property updated" : "Property created",
        message: `"${savedProperty.name}" is ready to use in this project.`,
      });
      onSaved(savedProperty);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not save property",
        message: errorMessage(error),
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
          <span className="text-13 text-secondary">{editor.default_value ? "Checked" : "Unchecked"}</span>
        </div>
      );
    }

    if (editor.property_type === "SINGLE_SELECT") {
      return (
        <select
          className="w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 outline-none"
          value={typeof editor.default_value === "string" ? editor.default_value : ""}
          onChange={(event) => setEditor((current) => ({ ...current, default_value: event.target.value }))}
        >
          <option value="">Select an option</option>
          {activeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name || "Untitled option"}
            </option>
          ))}
        </select>
      );
    }

    if (editor.property_type === "MULTI_SELECT") {
      const selectedValues = Array.isArray(editor.default_value) ? editor.default_value : [];
      return (
        <WorkItemMultiSelectInput
          source={editor.multi_select_source}
          projectId={projectId}
          manualOptions={activeOptions.map((option) => ({ id: option.id, label: option.name || "Untitled option" }))}
          value={selectedValues}
          onChange={(defaultValue) => setEditor((current) => ({ ...current, default_value: defaultValue }))}
          placeholder={editor.multi_select_source === "MEMBERS" ? "Select project members" : "Select options"}
        />
      );
    }

    if (editor.property_type === "LONG_TEXT") {
      return (
        <TextArea
          value={typeof editor.default_value === "string" ? editor.default_value : ""}
          onChange={(event) => setEditor((current) => ({ ...current, default_value: event.target.value }))}
          placeholder="Default value"
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
        placeholder="Default value"
      />
    );
  };

  return (
    <div className="rounded-lg border border-subtle bg-surface-1 p-5">
      <div className="mb-5">
        <h3 className="text-15 font-semibold text-primary">{property ? "Edit property" : "New property"}</h3>
        <p className="mt-1 text-12 text-tertiary">
          The property belongs only to this project. Its type cannot be changed after creation.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label htmlFor="work-item-property-name" className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          Name
          <Input
            id="work-item-property-name"
            value={editor.name}
            onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. Customer tier"
            hasError={!editor.name.trim()}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          Type
          <select
            className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            value={editor.property_type}
            disabled={Boolean(property)}
            onChange={(event) => updateType(event.target.value as TWorkItemPropertyType)}
          >
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {editor.property_type === "MULTI_SELECT" && (
        <label className="mt-5 flex flex-col gap-1.5 text-12 font-medium text-secondary">
          Multi-select source
          <select
            className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            value={editor.multi_select_source}
            disabled={Boolean(property)}
            onChange={(event) => updateMultiSelectSource(event.target.value as TWorkItemMultiSelectSource)}
          >
            <option value="MANUAL">Manual list</option>
            <option value="MEMBERS">Project members</option>
          </select>
          <span className="font-normal text-11 text-tertiary">
            Project members are loaded dynamically and always use their current profile names.
          </span>
        </label>
      )}

      <label
        htmlFor="work-item-property-description"
        className="mt-5 flex flex-col gap-1.5 text-12 font-medium text-secondary"
      >
        Description
        <TextArea
          id="work-item-property-description"
          value={editor.description}
          onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
          placeholder="Explain how this property should be used"
        />
      </label>

      <div className="mt-5 flex items-center justify-between rounded-md border border-subtle p-3">
        <div>
          <div className="text-13 font-medium text-primary">Required</div>
          <div className="text-11 text-tertiary">A value must be supplied before the work item can be saved.</div>
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
              <div className="text-13 font-medium text-primary">Options</div>
              <div className="text-11 text-tertiary">At least one active option is required.</div>
            </div>
            <Button variant="neutral-primary" size="sm" prependIcon={<Plus />} onClick={addOption}>
              Add option
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {activeOptions.map((option, index) => (
              <div key={option.id} className="flex items-center gap-2">
                <Input
                  className="w-full"
                  value={option.name}
                  onChange={(event) => updateOption(option.id, event.target.value)}
                  placeholder={`Option ${index + 1}`}
                  hasError={!option.name.trim()}
                />
                <button
                  type="button"
                  className="rounded p-2 text-tertiary hover:bg-surface-2 hover:text-danger-primary"
                  onClick={() => removeOption(option.id)}
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {activeOptions.length === 0 && (
              <div className="rounded-md border border-dashed border-subtle px-3 py-4 text-center text-12 text-tertiary">
                Add the first option to save this property.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-subtle p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-13 font-medium text-primary">Default value</div>
            <div className="text-11 text-tertiary">Used when a new work item does not provide a value.</div>
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
          Cancel
        </Button>
        <Button onClick={submit} loading={isSubmitting} disabled={!canSubmit}>
          {property ? "Save changes" : "Create property"}
        </Button>
      </div>
    </div>
  );
}
