// oxlint-disable promise/always-return
// oxlint-disable no-shadow
// oxlint-disable jsx_a11y/prefer-tag-over-role
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";
import useSWR from "swr";
// editor
import { ETabIndices, DEFAULT_WORK_ITEM_FORM_VALUES } from "@plane/constants";
import type { EditorRefApi } from "@plane/editor";
// i18n
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TIssue,
  TIssuePropertyValues,
  TProjectWorkItemPropertyValue,
  TWorkItemBuiltInFieldKey,
  TWorkspaceDraftIssue,
} from "@plane/types";
// hooks
import { ToggleSwitch } from "@plane/ui";
import {
  convertWorkItemDataToSearchResponse,
  getUpdateFormDataForReset,
  cn,
  getChangedIssuefields,
  getTabIndex,
} from "@plane/utils";
// components
import {
  IssueDefaultProperties,
  IssueDescriptionEditor,
  IssueParentTag,
  IssueProjectSelect,
  IssueTitleInput,
} from "@/components/issues/issue-modal/components";
import {
  buildDefaultPropertyValues,
  getProjectWorkItemPropertiesSWRKey,
  WorkItemPropertyFormFields,
} from "@/components/issues/work-item-properties";
// helpers
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useProjectIssueProperties } from "@/hooks/use-project-issue-properties";
import { ProjectService } from "@/services/project";
import { PendingIssueAttachments } from "./components/pending-attachments";
import type { TPendingIssueAttachment } from "./components/pending-attachments";

export interface IssueFormProps {
  data?: Partial<TIssue>;
  issueTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  isCreateMoreToggleEnabled: boolean;
  onAssetUpload: (assetId: string) => void;
  pendingAttachments: TPendingIssueAttachment[];
  onPendingAttachmentsAdd: (files: File[]) => void;
  onPendingAttachmentRemove: (attachmentId: string) => void;
  onPendingAttachmentsClear: () => void;
  onCreateMoreToggleChange: (value: boolean) => void;
  onChange?: (formData: Partial<TIssue> | null) => void;
  onClose: () => void;
  onSubmit: (values: Partial<TIssue>, is_draft_issue?: boolean) => Promise<void>;
  projectId: string;
  isDraft: boolean;
  moveToIssue?: boolean;
  modalTitle?: string;
  primaryButtonText?: {
    default: string;
    loading: string;
  };
  isDuplicateModalOpen: boolean;
  handleDuplicateIssueModal: (isOpen: boolean) => void;
  handleDraftAndClose?: () => void;
  isProjectSelectionDisabled?: boolean;
  showActionButtons?: boolean;
  dataResetProperties?: any[];
}

const isEmptyRequiredValue = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

export const IssueFormRoot = observer(function IssueFormRoot(props: IssueFormProps) {
  const { t } = useTranslation();
  const {
    data,
    issueTitleRef,
    onAssetUpload,
    pendingAttachments,
    onPendingAttachmentsAdd,
    onPendingAttachmentRemove,
    onPendingAttachmentsClear,
    onChange,
    onClose,
    onSubmit,
    projectId: defaultProjectId,
    isCreateMoreToggleEnabled,
    onCreateMoreToggleChange,
    isDraft,
    moveToIssue = false,
    modalTitle = `${data?.id ? t("update") : isDraft ? t("create_a_draft") : t("create_new_issue")}`,
    primaryButtonText = {
      default: `${data?.id ? t("update") : isDraft ? t("save_to_drafts") : t("save")}`,
      loading: `${data?.id ? t("updating") : t("saving")}`,
    },
    isProjectSelectionDisabled = false,
    showActionButtons = true,
    dataResetProperties = [],
  } = props;

  // states
  const [gptAssistantModal, setGptAssistantModal] = useState(false);
  const [isMoving, setIsMoving] = useState<boolean>(false);
  const [propertyValues, setPropertyValues] = useState<TIssuePropertyValues>({});
  const [propertyErrors, setPropertyErrors] = useState<Record<string, string>>({});

  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const submitBtnRef = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // router
  const { workspaceSlug, projectId: routeProjectId } = useParams();

  // store hooks
  const { getProjectById } = useProject();
  const {
    workItemTemplateId,
    isApplyingTemplate,
    selectedParentIssue,
    setWorkItemTemplateId,
    setSelectedParentIssue,
    getIssueTypeIdOnProjectChange,
    getActiveAdditionalPropertiesLength,
    handleTemplateChange,
  } = useIssueModal();
  const { isMobile } = usePlatformOS();
  const { moveIssue } = useWorkspaceDraftIssues();

  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { fetchCycles } = useProjectIssueProperties();
  const { fetchProjectStates, getProjectDefaultStateId, getStateById } = useProjectState();
  const projectService = useMemo(() => new ProjectService(), []);

  // form info
  const methods = useForm<TIssue>({
    defaultValues: { ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: defaultProjectId, ...data },
    reValidateMode: "onChange",
  });
  const {
    formState,
    formState: { isDirty, isSubmitting, dirtyFields },
    handleSubmit,
    reset,
    watch,
    control,
    getValues,
    setValue,
  } = methods;

  const projectId = watch("project_id");
  const stateId = watch("state_id");
  const previousAttachmentProjectIdRef = useRef(projectId);
  const workspaceSlugString = workspaceSlug?.toString();
  const { data: fieldConfiguration, isLoading: isFieldConfigurationLoading } = useSWR(
    workspaceSlugString && projectId ? `WORK_ITEM_FIELD_CONFIGURATION_${workspaceSlugString}_${projectId}` : null,
    () => projectService.getWorkItemFieldConfiguration(workspaceSlugString!, projectId!)
  );
  const { data: customProperties = [], isLoading: areCustomPropertiesLoading } = useSWR(
    workspaceSlugString && projectId ? getProjectWorkItemPropertiesSWRKey(workspaceSlugString, projectId) : null,
    () => projectService.getWorkItemProperties(workspaceSlugString!, projectId!)
  );
  const hiddenFieldKeys = Object.entries(fieldConfiguration?.built_in_fields ?? {})
    .filter(([, settings]) => !settings.visible)
    .map(([fieldKey]) => fieldKey as TWorkItemBuiltInFieldKey);
  const activeAdditionalPropertiesLength =
    getActiveAdditionalPropertiesLength({
      projectId,
      workspaceSlug: workspaceSlugString,
      watch,
    }) + customProperties.length;

  const isDisabled = isSubmitting || isApplyingTemplate || isFieldConfigurationLoading || areCustomPropertiesLoading;

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  useEffect(() => {
    if (previousAttachmentProjectIdRef.current !== projectId) {
      onPendingAttachmentsClear();
      previousAttachmentProjectIdRef.current = projectId;
    }
  }, [onPendingAttachmentsClear, projectId]);

  //reset few fields on projectId change
  useEffect(() => {
    if (isDirty) {
      if (workItemTemplateId) {
        // reset work item template id
        setWorkItemTemplateId(null);
        reset({ ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: projectId });
        editorRef.current?.clearEditor();
      } else {
        reset(getUpdateFormDataForReset(projectId, getValues()));
      }
    }
    if (projectId && routeProjectId !== projectId) fetchCycles(workspaceSlug?.toString(), projectId);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Reset form when data prop changes
  useEffect(() => {
    if (data) {
      reset({ ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: projectId, ...data });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dataResetProperties]);

  // StateDropdown can render the project's default state without writing it to
  // react-hook-form. Run this after the form reset effects so the actual value
  // cannot be overwritten before the untouched form is submitted.
  useEffect(() => {
    if (!workspaceSlug || !projectId || data?.id || stateId) return;

    let isActive = true;
    const initializeDefaultState = async () => {
      let defaultStateId: string | undefined;
      try {
        defaultStateId = getProjectDefaultStateId(projectId);
        if (!defaultStateId) {
          const states = await fetchProjectStates(workspaceSlug.toString(), projectId);
          defaultStateId = states.find((state) => state.default)?.id;
        }
      } catch {
        return;
      }

      if (isActive && defaultStateId && !getValues("state_id")) {
        setValue("state_id", defaultStateId, { shouldValidate: true });
      }
    };

    initializeDefaultState();
    return () => {
      isActive = false;
    };
  }, [data?.id, fetchProjectStates, getProjectDefaultStateId, getValues, projectId, setValue, stateId, workspaceSlug]);

  useEffect(() => {
    const sourceValues = data?.project_id === projectId ? data.property_values : {};
    setPropertyValues(buildDefaultPropertyValues(customProperties, sourceValues));
    setPropertyErrors({});
  }, [customProperties, data?.id, data?.project_id, data?.property_values, projectId]);

  // Update the issue type id when the project id changes
  useEffect(() => {
    const issueTypeId = watch("type_id");

    // if issue type id is present or project not available, return
    if (issueTypeId || !projectId) return;

    // get issue type id on project change
    const issueTypeIdOnProjectChange = getIssueTypeIdOnProjectChange(projectId);
    if (issueTypeIdOnProjectChange) setValue("type_id", issueTypeIdOnProjectChange, { shouldValidate: true });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, projectId]);

  useEffect(() => {
    if (workItemTemplateId && editorRef.current) {
      handleTemplateChange({
        workspaceSlug: workspaceSlug?.toString(),
        reset,
        editorRef,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemTemplateId]);

  const validateRequiredFields = (formData: Partial<TIssue>) => {
    const nextPropertyErrors: Record<string, string> = {};
    customProperties.forEach((property) => {
      if (property.is_required && isEmptyRequiredValue(propertyValues[property.id])) {
        nextPropertyErrors[property.id] = "This property is required.";
      }
    });
    setPropertyErrors(nextPropertyErrors);

    const builtInValues: Record<TWorkItemBuiltInFieldKey, unknown> = {
      project: formData.project_id,
      title: formData.name,
      description: formData.description_html
        ?.replace(/<[^>]*>/g, "")
        .replaceAll("&nbsp;", " ")
        .trim(),
      state: formData.state_id,
      priority: formData.priority === "none" ? null : formData.priority,
      assignees: formData.assignee_ids,
      labels: formData.label_ids,
      start_date: formData.start_date,
      target_date: formData.target_date,
      cycle: formData.cycle_id,
      module: formData.module_ids,
      estimate: formData.estimate_point,
      parent: formData.parent_id,
    };
    const missingBuiltInField = Object.entries(fieldConfiguration?.built_in_fields ?? {}).find(
      ([fieldKey, settings]) =>
        settings.visible &&
        settings.required &&
        isEmptyRequiredValue(builtInValues[fieldKey as TWorkItemBuiltInFieldKey])
    );

    if (missingBuiltInField || Object.keys(nextPropertyErrors).length > 0) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: missingBuiltInField
          ? `The required field "${missingBuiltInField[0]}" is empty.`
          : "Fill in all required custom properties.",
      });
      return false;
    }
    return true;
  };

  const handleFormSubmit = async (formData: Partial<TIssue>, is_draft_issue = false) => {
    // Check if the editor is ready to discard
    if (!editorRef.current?.isEditorReadyToDiscard()) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("editor_is_not_ready_to_discard_changes"),
      });
      return;
    }

    if (!is_draft_issue && !isDraft && !validateRequiredFields(formData)) return;

    const formDataWithProperties: Partial<TIssue> = {
      ...formData,
      property_values: propertyValues,
    };

    const submitData = !data?.id
      ? formDataWithProperties
      : {
          ...getChangedIssuefields(formDataWithProperties, dirtyFields as { [key: string]: boolean | undefined }),
          project_id: getValues<"project_id">("project_id"),
          id: data.id,
          description_html: formDataWithProperties.description_html ?? "<p></p>",
          property_values: propertyValues,
          type_id: getValues<"type_id">("type_id"),
        };

    // this condition helps to move the issues from draft to project issues
    if (formData.hasOwnProperty("is_draft")) submitData.is_draft = formData.is_draft;

    await onSubmit(submitData, is_draft_issue)
      .then(() => {
        setGptAssistantModal(false);
        if (isCreateMoreToggleEnabled && workItemTemplateId) {
          handleTemplateChange({
            workspaceSlug: workspaceSlug?.toString(),
            reset,
            editorRef,
          });
        } else {
          reset({
            ...DEFAULT_WORK_ITEM_FORM_VALUES,
            ...(isCreateMoreToggleEnabled ? { ...data } : {}),
            project_id: getValues<"project_id">("project_id"),
            type_id: getValues<"type_id">("type_id"),
            description_html: data?.description_html ?? "<p></p>",
          });
          setPropertyValues(
            buildDefaultPropertyValues(
              customProperties,
              isCreateMoreToggleEnabled && data?.property_values ? data.property_values : {}
            )
          );
          setPropertyErrors({});
          editorRef?.current?.clearEditor();
        }
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const handleMoveToProjects = async () => {
    if (!data?.id || !data?.project_id || !data) return;
    const formValues = getValues();
    if (!validateRequiredFields(formValues)) return;
    setIsMoving(true);
    try {
      await moveIssue(workspaceSlug.toString(), data.id, {
        ...data,
        ...formValues,
        property_values: propertyValues,
      } as TWorkspaceDraftIssue);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: "Failed to move work item to project. Please try again.",
      });
    } finally {
      setIsMoving(false);
    }
  };

  const condition =
    (watch("name") && watch("name") !== "") || (watch("description_html") && watch("description_html") !== "<p></p>");

  const handleFormChange = () => {
    if (!onChange) return;

    if (isDirty && condition) onChange({ ...watch(), property_values: propertyValues });
    else onChange(null);
  };

  const handlePropertyValueChange = (propertyId: string, value: TProjectWorkItemPropertyValue) => {
    setPropertyValues((currentValues) => {
      const nextValues = { ...currentValues, [propertyId]: value };
      if (onChange && condition) onChange({ ...watch(), property_values: nextValues });
      return nextValues;
    });
    setPropertyErrors((currentErrors) => {
      if (!currentErrors[propertyId]) return currentErrors;
      const nextErrors = { ...currentErrors };
      delete nextErrors[propertyId];
      return nextErrors;
    });
  };

  // executing this useEffect when the parent_id coming from the component prop
  useEffect(() => {
    const parentId = watch("parent_id") || undefined;
    if (!parentId) return;
    if (parentId === selectedParentIssue?.id || selectedParentIssue) return;

    const issue = getIssueById(parentId);
    if (!issue) return;

    const projectDetails = getProjectById(issue.project_id);
    if (!projectDetails) return;

    const stateDetails = getStateById(issue.state_id);

    setSelectedParentIssue(
      convertWorkItemDataToSearchResponse(workspaceSlug?.toString(), issue, projectDetails, stateDetails)
    );
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
  }, [watch, getIssueById, getProjectById, selectedParentIssue, getStateById]);

  // executing this useEffect when isDirty changes
  useEffect(() => {
    if (!onChange) return;

    if (isDirty && condition) onChange({ ...watch(), property_values: propertyValues });
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useEffect(() => {
    const formElement = formRef?.current;
    const modalElement = modalContainerRef?.current;

    if (!formElement || !modalElement) return;

    const resizeObserver = new ResizeObserver(() => {
      modalElement.style.maxHeight = `${formElement?.offsetHeight}px`;
    });

    resizeObserver.observe(formElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [formRef, modalContainerRef]);

  return (
    <FormProvider {...methods}>
      <div className="flex gap-2 bg-transparent">
        <div className="w-full rounded-lg">
          <form
            ref={formRef}
            onSubmit={handleSubmit((data) => handleFormSubmit(data))}
            className="flex w-full flex-col"
          >
            <div className="rounded-t-lg bg-surface-1 p-5">
              <h3 className="pb-2 text-h4-medium text-secondary">{modalTitle}</h3>
              <div className="flex items-center justify-between pt-2 pb-4">
                <div className="flex items-center gap-x-1">
                  <IssueProjectSelect
                    control={control}
                    disabled={!!data?.id || !!data?.sourceIssueId || isProjectSelectionDisabled}
                    handleFormChange={handleFormChange}
                  />
                </div>
              </div>
              {!hiddenFieldKeys.includes("parent") && watch("parent_id") && selectedParentIssue && (
                <div className="pb-4">
                  <IssueParentTag
                    control={control}
                    selectedParentIssue={selectedParentIssue}
                    handleFormChange={handleFormChange}
                    setSelectedParentIssue={setSelectedParentIssue}
                  />
                </div>
              )}
              <div className="space-y-1">
                <IssueTitleInput
                  control={control}
                  issueTitleRef={issueTitleRef}
                  formState={formState}
                  handleFormChange={handleFormChange}
                />
              </div>
            </div>
            <div
              className={cn(
                "space-y-3 bg-surface-1 pb-4",
                activeAdditionalPropertiesLength > 4 &&
                  "vertical-scrollbar scrollbar-sm max-h-[45vh] overflow-hidden overflow-y-auto"
              )}
            >
              <div className="px-5">
                <IssueDescriptionEditor
                  control={control}
                  isDraft={isDraft}
                  issueName={watch("name")}
                  issueId={data?.id}
                  descriptionHtmlData={data?.description_html}
                  editorRef={editorRef}
                  submitBtnRef={submitBtnRef}
                  gptAssistantModal={gptAssistantModal}
                  workspaceSlug={workspaceSlug?.toString()}
                  projectId={projectId}
                  handleFormChange={handleFormChange}
                  handleDescriptionHTMLDataChange={(description_html) =>
                    setValue<"description_html">("description_html", description_html)
                  }
                  setGptAssistantModal={setGptAssistantModal}
                  handleGptAssistantClose={() => reset(getValues())}
                  onAssetUpload={onAssetUpload}
                  onClose={onClose}
                />
              </div>
              {!data?.id && !isDraft && workspaceSlugString && projectId && (
                <div className="px-5">
                  <PendingIssueAttachments
                    attachments={pendingAttachments}
                    disabled={isDisabled}
                    workspaceSlug={workspaceSlugString}
                    projectId={projectId}
                    onFilesAdd={onPendingAttachmentsAdd}
                    onFileRemove={onPendingAttachmentRemove}
                  />
                </div>
              )}
              <div className="px-5">
                <WorkItemPropertyFormFields
                  properties={customProperties}
                  values={propertyValues}
                  errors={propertyErrors}
                  isLoading={isFieldConfigurationLoading || areCustomPropertiesLoading}
                  onChange={handlePropertyValueChange}
                />
              </div>
            </div>
            <div
              className={cn(
                "rounded-b-lg border-t-[0.5px] border-subtle bg-surface-1 px-4 py-3",
                activeAdditionalPropertiesLength > 0 && "shadow-raised-100"
              )}
            >
              <div className="pb-3">
                <IssueDefaultProperties
                  control={control}
                  id={data?.id}
                  projectId={projectId}
                  workspaceSlug={workspaceSlug?.toString()}
                  selectedParentIssue={selectedParentIssue}
                  startDate={watch("start_date")}
                  targetDate={watch("target_date")}
                  parentId={watch("parent_id")}
                  isDraft={isDraft}
                  handleFormChange={handleFormChange}
                  setSelectedParentIssue={setSelectedParentIssue}
                  hiddenFieldKeys={hiddenFieldKeys}
                />
              </div>
              {showActionButtons && (
                <div
                  className="flex items-center justify-end gap-4 border-t-[0.5px] border-subtle pt-6 pb-3"
                  tabIndex={getIndex("create_more")}
                >
                  {!data?.id && (
                    <div
                      className="inline-flex cursor-pointer items-center gap-1.5"
                      onClick={() => onCreateMoreToggleChange(!isCreateMoreToggleEnabled)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCreateMoreToggleChange(!isCreateMoreToggleEnabled);
                      }}
                      role="button"
                    >
                      <ToggleSwitch value={isCreateMoreToggleEnabled} onChange={() => {}} size="sm" />
                      <span className="text-caption-sm-regular">{t("create_more")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div tabIndex={getIndex("discard_button")}>
                      <Button
                        variant="secondary"
                        size="lg"
                        disabled={isDisabled}
                        onClick={() => {
                          if (editorRef.current?.isEditorReadyToDiscard()) {
                            onClose();
                          } else {
                            setToast({
                              type: TOAST_TYPE.ERROR,
                              title: "Error!",
                              message: "Editor is still processing changes. Please wait before proceeding.",
                            });
                          }
                        }}
                      >
                        {t("discard")}
                      </Button>
                    </div>
                    <div tabIndex={isDraft ? getIndex("submit_button") : getIndex("draft_button")}>
                      <Button
                        variant={moveToIssue ? "secondary" : "primary"}
                        size="lg"
                        type="submit"
                        ref={submitBtnRef}
                        loading={isSubmitting}
                        disabled={isDisabled}
                      >
                        {isSubmitting ? primaryButtonText.loading : primaryButtonText.default}
                      </Button>
                    </div>

                    {moveToIssue && (
                      <Button
                        variant="primary"
                        type="button"
                        loading={isMoving}
                        onClick={handleMoveToProjects}
                        disabled={isMoving}
                        size="lg"
                      >
                        {t("add_to_project")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </FormProvider>
  );
});
