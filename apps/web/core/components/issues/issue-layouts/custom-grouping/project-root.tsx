/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Pencil, Plus, Settings2, Trash2, Users } from "lucide-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TCustomGroupingAccess,
  TCustomGroupingDateBucket,
  TProjectCustomGrouping,
  TProjectCustomGroupingPayload,
  TProjectWorkItemProperty,
} from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { Button, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { useUser } from "@/hooks/store/user";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useProjectWorkItemFieldVisibility } from "@/hooks/use-project-work-item-field-visibility";
import { ProjectService } from "@/services/project";
import { useProjectWorkItemProperties } from "../../work-item-properties/use-project-work-item-properties";
import { ProjectIssueQuickActions } from "../quick-action-dropdowns";
import { BaseListRoot } from "../list/base-list-root";

const projectService = new ProjectService();

const SYSTEM_FIELDS = [
  ["state", "issue.custom_grouping.fields.state"],
  ["assignees", "issue.custom_grouping.fields.assignees"],
  ["priority", "issue.custom_grouping.fields.priority"],
  ["labels", "issue.custom_grouping.fields.labels"],
  ["cycle", "issue.custom_grouping.fields.cycle"],
  ["module", "issue.custom_grouping.fields.module"],
  ["created_by", "issue.custom_grouping.fields.created_by"],
  ["start_date", "issue.custom_grouping.fields.start_date"],
  ["target_date", "issue.custom_grouping.fields.target_date"],
] as const;

const MULTI_VALUE_SYSTEM_FIELDS = new Set(["assignees", "labels", "module"]);
const DATE_SYSTEM_FIELDS = new Set(["start_date", "target_date"]);
const SUPPORTED_PROPERTY_TYPES = new Set(["DATE", "CHECKBOX", "SINGLE_SELECT", "MULTI_SELECT"]);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const value = Object.values(error)[0];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
};

type GroupingFormProps = {
  isOpen: boolean;
  initialValue: TProjectCustomGrouping | null;
  properties: TProjectWorkItemProperty[];
  isProjectAdmin: boolean;
  visibleSystemFields: string[];
  onClose: () => void;
  onSave: (payload: TProjectCustomGroupingPayload) => Promise<void>;
};

function GroupingForm({
  isOpen,
  initialValue,
  properties,
  isProjectAdmin,
  visibleSystemFields,
  onClose,
  onSave,
}: GroupingFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [groupBy, setGroupBy] = useState("state");
  const [access, setAccess] = useState<TCustomGroupingAccess>("PERSONAL");
  const [dateBucket, setDateBucket] = useState<TCustomGroupingDateBucket>("EXACT");
  const [saving, setSaving] = useState(false);

  const selectedProperty = groupBy.startsWith("customproperty_")
    ? properties.find((property) => property.id === groupBy.replace("customproperty_", ""))
    : undefined;
  const isDate = DATE_SYSTEM_FIELDS.has(groupBy) || selectedProperty?.property_type === "DATE";

  useEffect(() => {
    if (!isOpen) return;
    setName(initialValue?.name ?? "");
    setGroupBy(initialValue?.group_by ?? visibleSystemFields[0] ?? "created_by");
    setAccess(initialValue?.access ?? "PERSONAL");
    setDateBucket(initialValue?.date_bucket ?? "EXACT");
  }, [initialValue, isOpen, visibleSystemFields]);

  const submit = async () => {
    if (!name.trim() || !groupBy) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        group_by: groupBy,
        access,
        date_bucket: isDate ? dateBucket : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <h3 className="text-18 font-semibold text-primary">
            {initialValue ? t("issue.custom_grouping.form.edit_title") : t("issue.custom_grouping.form.create_title")}
          </h3>
          <p className="mt-1 text-12 text-tertiary">{t("issue.custom_grouping.form.description")}</p>
        </div>
        <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          {t("issue.custom_grouping.form.name")}
          <input
            className="h-9 rounded-md border border-subtle bg-surface-1 px-3 text-13 text-primary outline-none focus:border-accent-strong"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
          {t("issue.custom_grouping.form.field")}
          <select
            className="h-9 rounded-md border border-subtle bg-surface-1 px-3 text-13 text-primary outline-none focus:border-accent-strong"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value)}
          >
            <optgroup label={t("issue.custom_grouping.form.system_fields")}>
              {SYSTEM_FIELDS.filter(([value]) => visibleSystemFields.includes(value)).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </optgroup>
            {properties.length > 0 && (
              <optgroup label={t("issue.custom_grouping.form.custom_fields")}>
                {properties.map((property) => (
                  <option key={property.id} value={`customproperty_${property.id}`}>
                    {property.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {isDate && (
          <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
            {t("issue.custom_grouping.form.date_grouping")}
            <select
              className="h-9 rounded-md border border-subtle bg-surface-1 px-3 text-13 text-primary outline-none focus:border-accent-strong"
              value={dateBucket}
              onChange={(event) => setDateBucket(event.target.value as TCustomGroupingDateBucket)}
            >
              <option value="EXACT">{t("issue.custom_grouping.date_bucket.exact")}</option>
              <option value="DAY">{t("issue.custom_grouping.date_bucket.day")}</option>
              <option value="WEEK">{t("issue.custom_grouping.date_bucket.week")}</option>
              <option value="MONTH">{t("issue.custom_grouping.date_bucket.month")}</option>
            </select>
          </label>
        )}
        {isProjectAdmin && (
          <label className="flex flex-col gap-1.5 text-12 font-medium text-secondary">
            {t("issue.custom_grouping.form.visibility")}
            <select
              className="h-9 rounded-md border border-subtle bg-surface-1 px-3 text-13 text-primary outline-none focus:border-accent-strong"
              value={access}
              onChange={(event) => setAccess(event.target.value as TCustomGroupingAccess)}
            >
              <option value="PERSONAL">{t("issue.custom_grouping.access.personal")}</option>
              <option value="PROJECT">{t("issue.custom_grouping.access.project")}</option>
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="neutral-primary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={saving} disabled={!name.trim() || !groupBy}>
            {t("issue.custom_grouping.form.save")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}

export const ProjectCustomGroupingLayout = observer(function ProjectCustomGroupingLayout() {
  const { workspaceSlug: workspaceSlugParam, projectId: projectIdParam } = useParams();
  const workspaceSlug = workspaceSlugParam?.toString();
  const projectId = projectIdParam?.toString();
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { issuesFilter } = useIssues(EIssuesStoreType.PROJECT);
  const properties = useProjectWorkItemProperties().filter(
    (property) => !property.archived_at && SUPPORTED_PROPERTY_TYPES.has(property.property_type)
  );
  const { isFieldVisible } = useProjectWorkItemFieldVisibility(workspaceSlug, projectId);

  const key = workspaceSlug && projectId ? `PROJECT_CUSTOM_GROUPINGS_${workspaceSlug}_${projectId}` : null;
  const preferenceKey =
    workspaceSlug && projectId ? `PROJECT_CUSTOM_GROUPING_PREFERENCE_${workspaceSlug}_${projectId}` : null;
  const {
    data: groupings = [],
    isLoading,
    mutate,
  } = useSWR(key, () => projectService.getCustomGroupings(workspaceSlug as string, projectId as string));
  const { data: preference, mutate: mutatePreference } = useSWR(preferenceKey, () =>
    projectService.getCustomGroupingPreference(workspaceSlug as string, projectId as string)
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<TProjectCustomGrouping | null>(null);
  const activeGrouping = useMemo(
    () => groupings.find((grouping) => grouping.id === preference?.active_grouping) ?? groupings[0],
    [groupings, preference?.active_grouping]
  );
  const isProjectAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const visibleSystemFields = SYSTEM_FIELDS.map(([value]) => value).filter((value) => {
    if (value === "created_by") return true;
    return isFieldVisible(value as Parameters<typeof isFieldVisible>[0]);
  });
  const selectedProperty = activeGrouping?.group_by.startsWith("customproperty_")
    ? properties.find((property) => property.id === activeGrouping.group_by.replace("customproperty_", ""))
    : undefined;
  const disableGroupDrag = activeGrouping
    ? MULTI_VALUE_SYSTEM_FIELDS.has(activeGrouping.group_by) || selectedProperty?.property_type === "MULTI_SELECT"
    : false;

  const selectGrouping = useCallback(
    async (grouping: TProjectCustomGrouping) => {
      if (!workspaceSlug || !projectId) return;
      const resolvedGroupBy =
        grouping.date_bucket === "WEEK" || grouping.date_bucket === "MONTH"
          ? `datebucket_${grouping.date_bucket.toLowerCase()}_${grouping.group_by}`
          : grouping.group_by;
      await issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS, {
        group_by: resolvedGroupBy as never,
        custom_grouping_id: grouping.id,
        show_empty_groups: false,
      });
      const nextPreference = await projectService.updateCustomGroupingPreference(workspaceSlug, projectId, {
        active_grouping: grouping.id,
      });
      await mutatePreference(nextPreference, { revalidate: false });
    },
    [issuesFilter, mutatePreference, projectId, workspaceSlug]
  );

  useEffect(() => {
    if (!activeGrouping || !workspaceSlug || !projectId) return;
    const current = issuesFilter.issueFilters?.displayFilters;
    const resolvedGroupBy =
      activeGrouping.date_bucket === "WEEK" || activeGrouping.date_bucket === "MONTH"
        ? `datebucket_${activeGrouping.date_bucket.toLowerCase()}_${activeGrouping.group_by}`
        : activeGrouping.group_by;
    if (current?.group_by === resolvedGroupBy && current.custom_grouping_id === activeGrouping.id) return;
    void selectGrouping(activeGrouping);
  }, [activeGrouping, issuesFilter.issueFilters?.displayFilters, projectId, selectGrouping, workspaceSlug]);

  const saveGrouping = async (payload: TProjectCustomGroupingPayload) => {
    if (!workspaceSlug || !projectId) return;
    try {
      const saved = editing
        ? await projectService.updateCustomGrouping(workspaceSlug, projectId, editing.id, payload)
        : await projectService.createCustomGrouping(workspaceSlug, projectId, payload);
      await mutate(
        (current = []) =>
          editing ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved],
        { revalidate: false }
      );
      await selectGrouping(saved);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.success"),
        message: t("issue.custom_grouping.toast.saved"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("common.error"),
        message: getErrorMessage(error, t("issue.custom_grouping.toast.save_error")),
      });
      throw error;
    }
  };

  const deleteGrouping = async (grouping: TProjectCustomGrouping) => {
    if (
      !workspaceSlug ||
      !projectId ||
      !window.confirm(t("issue.custom_grouping.delete_confirm", { name: grouping.name }))
    )
      return;
    try {
      await projectService.deleteCustomGrouping(workspaceSlug, projectId, grouping.id);
      const remaining = groupings.filter((item) => item.id !== grouping.id);
      await mutate(remaining, { revalidate: false });
      if (preference?.active_grouping === grouping.id) {
        const nextId = remaining[0]?.id ?? null;
        const nextPreference = await projectService.updateCustomGroupingPreference(workspaceSlug, projectId, {
          active_grouping: nextId,
        });
        await mutatePreference(nextPreference, { revalidate: false });
      }
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("common.error"),
        message: getErrorMessage(error, t("issue.custom_grouping.toast.delete_error")),
      });
    }
  };

  const toggleCollapsedGroup = useCallback(
    async (groupId: string) => {
      if (!workspaceSlug || !projectId || !activeGrouping || !preference) return;
      const current = preference.collapsed_groups[activeGrouping.id] ?? [];
      const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId];
      const nextPreference = {
        ...preference,
        collapsed_groups: { ...preference.collapsed_groups, [activeGrouping.id]: next },
      };
      await mutatePreference(nextPreference, { revalidate: false });
      try {
        const saved = await projectService.updateCustomGroupingPreference(workspaceSlug, projectId, {
          collapsed_groups: nextPreference.collapsed_groups,
        });
        await mutatePreference(saved, { revalidate: false });
      } catch {
        await mutatePreference(preference, { revalidate: false });
      }
    },
    [activeGrouping, mutatePreference, preference, projectId, workspaceSlug]
  );

  if (!workspaceSlug || !projectId) return null;

  const canEditActive =
    !!activeGrouping &&
    (activeGrouping.access === "PROJECT" ? isProjectAdmin : activeGrouping.owned_by === currentUser?.id);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-surface-1 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Settings2 className="size-4 shrink-0 text-tertiary" />
        <select
          className="h-8 max-w-72 rounded-md border border-subtle bg-surface-1 px-2.5 text-13 font-medium text-primary outline-none focus:border-accent-strong"
          value={activeGrouping?.id ?? ""}
          onChange={(event) => {
            const grouping = groupings.find((item) => item.id === event.target.value);
            if (grouping) void selectGrouping(grouping);
          }}
          disabled={!activeGrouping}
        >
          {groupings.map((grouping) => (
            <option key={grouping.id} value={grouping.id}>
              {grouping.access === "PROJECT" ? `◆ ${grouping.name}` : grouping.name}
            </option>
          ))}
        </select>
        {activeGrouping?.access === "PROJECT" && (
          <span className="inline-flex items-center gap-1 rounded bg-accent-subtle px-2 py-1 text-11 text-accent-primary">
            <Users className="size-3" /> {t("issue.custom_grouping.access.project")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canEditActive && (
          <>
            <Button
              variant="neutral-primary"
              size="sm"
              prependIcon={<Pencil />}
              onClick={() => {
                setEditing(activeGrouping);
                setIsFormOpen(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              variant="neutral-primary"
              size="sm"
              aria-label={t("common.delete")}
              onClick={() => void deleteGrouping(activeGrouping)}
            >
              <Trash2 />
            </Button>
          </>
        )}
        <Button
          size="sm"
          prependIcon={<Plus />}
          onClick={() => {
            setEditing(null);
            setIsFormOpen(true);
          }}
        >
          {t("issue.custom_grouping.new")}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {isLoading ? (
        <div className="flex size-full items-center justify-center text-13 text-tertiary">{t("common.loading")}</div>
      ) : !activeGrouping ? (
        <div className="flex size-full flex-col items-center justify-center gap-3 bg-surface-1 p-6 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-layer-2">
            <Settings2 className="size-5 text-tertiary" />
          </div>
          <div>
            <h3 className="text-16 font-semibold text-primary">{t("issue.custom_grouping.empty.title")}</h3>
            <p className="mt-1 max-w-md text-13 text-tertiary">{t("issue.custom_grouping.empty.description")}</p>
          </div>
          <Button
            prependIcon={<Plus />}
            onClick={() => {
              setEditing(null);
              setIsFormOpen(true);
            }}
          >
            {t("issue.custom_grouping.new")}
          </Button>
        </div>
      ) : (
        <BaseListRoot
          QuickActions={ProjectIssueQuickActions}
          layout={EIssueLayoutTypes.CUSTOM_GROUPING}
          header={toolbar}
          collapsedGroupsOverride={preference?.collapsed_groups[activeGrouping.id] ?? []}
          onCollapsedGroupToggle={toggleCollapsedGroup}
          disableGroupDrag={disableGroupDrag}
        />
      )}
      <GroupingForm
        isOpen={isFormOpen}
        initialValue={editing}
        properties={properties}
        isProjectAdmin={isProjectAdmin}
        visibleSystemFields={visibleSystemFields}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(null);
        }}
        onSave={saveGrouping}
      />
    </>
  );
});
