/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
// Plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// services
import { FileService } from "@/services/file.service";
import { IssueAttachmentService } from "@/services/issue";
const fileService = new FileService();
const issueAttachmentService = new IssueAttachmentService();
// local imports
import { CreateIssueToastActionItems } from "../create-issue-toast-action-items";
import { DraftIssueLayout } from "./draft-issue-layout";
import { IssueFormRoot } from "./form";
import type { IssueFormProps } from "./form";
import type { IssuesModalProps } from "./modal";
import type { TPendingIssueAttachment } from "./components/pending-attachments";

const getStateTransitionErrorMessage = (error: any): string | undefined => {
  const transitionError = error?.state_transition ?? error?.response?.data?.state_transition;
  return Array.isArray(transitionError?.reasons) ? transitionError.reasons.join(" ") : undefined;
};

export const CreateUpdateIssueModalBase = observer(function CreateUpdateIssueModalBase(props: IssuesModalProps) {
  const {
    data,
    isOpen,
    onClose,
    beforeFormSubmit,
    onSubmit,
    withDraftIssueWrapper = true,
    storeType: issueStoreFromProps,
    isDraft = false,
    fetchIssueDetails = true,
    moveToIssue = false,
    modalTitle,
    primaryButtonText,
    isProjectSelectionDisabled = false,
    showActionItemsOnUpdate = false,
  } = props;
  const issueStoreType = useIssueStoreType();

  let storeType = issueStoreFromProps ?? issueStoreType;
  // Fallback to project store if epic store is used in issue modal.
  if (storeType === EIssuesStoreType.EPIC) {
    storeType = EIssuesStoreType.PROJECT;
  }
  // ref
  const issueTitleRef = useRef<HTMLInputElement>(null);
  // states
  const [changesMade, setChangesMade] = useState<Partial<TIssue> | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [description, setDescription] = useState<string | undefined>(undefined);
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<TPendingIssueAttachment[]>([]);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const { workspaceSlug, projectId: routerProjectId, cycleId, moduleId, workItem } = useParams();
  const { issues: projectIssues } = useIssues(EIssuesStoreType.PROJECT);
  const { issues: draftIssues } = useIssues(EIssuesStoreType.WORKSPACE_DRAFT);
  const { fetchIssue } = useIssueDetail();
  const { allowedProjectIds, handleCreateSubWorkItem } = useIssueModal();
  const { getProjectByIdentifier } = useProject();
  // current store details
  const { createIssue, updateIssue } = useIssuesActions(storeType);
  // derived values
  const routerProjectIdentifier = workItem?.toString().split("-")[0];
  const projectIdFromRouter = getProjectByIdentifier(routerProjectIdentifier)?.id;
  const projectId = data?.project_id ?? routerProjectId?.toString() ?? projectIdFromRouter;

  const fetchIssueDetail = async (issueId: string | undefined) => {
    setDescription(undefined);
    if (!workspaceSlug) return;

    if (!projectId || issueId === undefined || !fetchIssueDetails) {
      // Set description to the issue description from the props if available
      setDescription(data?.description_html || "<p></p>");
      return;
    }
    const response = await fetchIssue(workspaceSlug.toString(), projectId.toString(), issueId);
    if (response) setDescription(response?.description_html || "<p></p>");
  };

  useEffect(() => {
    // fetching issue details
    if (isOpen) fetchIssueDetail(data?.id ?? data?.sourceIssueId);

    // if modal is closed, reset active project to null
    // and return to avoid activeProjectId being set to some other project
    if (!isOpen) {
      setActiveProjectId(null);
      setPendingAttachments([]);
      return;
    }

    // if data is present, set active project to the project of the
    // issue. This has more priority than the project in the url.
    if (data && data.project_id) {
      setActiveProjectId(data.project_id);
      return;
    }

    // if data is not present, set active project to the first project in the allowedProjectIds array
    if (allowedProjectIds && allowedProjectIds.length > 0 && !activeProjectId)
      setActiveProjectId(projectId?.toString() ?? allowedProjectIds?.[0]);

    // clearing up the description state when we leave the component
    return () => setDescription(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.project_id, data?.id, data?.sourceIssueId, projectId, isOpen, activeProjectId]);

  const handleCreateMoreToggleChange = (value: boolean) => {
    setCreateMore(value);
  };

  const handleClose = (saveAsDraft?: boolean) => {
    if (changesMade && saveAsDraft && !data) {
      handleCreateIssue(changesMade, true);
    }

    setActiveProjectId(null);
    setChangesMade(null);
    setPendingAttachments([]);
    onClose();
    handleDuplicateIssueModal(false);
  };

  const handleCreateIssue = async (
    payload: Partial<TIssue>,
    is_draft_issue: boolean = false
  ): Promise<TIssue | undefined> => {
    if (!workspaceSlug || !payload.project_id) return;

    try {
      let response: TIssue | undefined;
      let failedAttachmentUploads = 0;
      // if draft issue, use draft issue store to create issue
      if (is_draft_issue) {
        response = (await draftIssues.createIssue(workspaceSlug.toString(), payload)) as TIssue;
      }
      // if cycle id in payload does not match the cycleId in url
      // or if the moduleIds in Payload does not match the moduleId in url
      // use the project issue store to create issues
      else if (
        (payload.cycle_id !== cycleId && storeType === EIssuesStoreType.CYCLE) ||
        (!payload.module_ids?.includes(moduleId?.toString()) && storeType === EIssuesStoreType.MODULE)
      ) {
        response = await projectIssues.createIssue(workspaceSlug.toString(), payload.project_id, payload);
      } // else just use the existing store type's create method
      else if (createIssue) {
        response = await createIssue(payload.project_id, payload);
      }

      if (!response) throw new Error();
      const responseProjectId = response.project_id ?? payload.project_id;

      // update uploaded assets' status
      if (uploadedAssetIds.length > 0) {
        await fileService.updateBulkProjectAssetsUploadStatus(
          workspaceSlug?.toString() ?? "",
          responseProjectId,
          response.id,
          {
            asset_ids: uploadedAssetIds,
          }
        );
        setUploadedAssetIds([]);
      }

      if (!is_draft_issue && pendingAttachments.length > 0) {
        setPendingAttachments((currentAttachments) =>
          currentAttachments.map((attachment) => ({ ...attachment, progress: 0, status: "uploading" }))
        );

        const uploadResults = await Promise.allSettled(
          pendingAttachments.map((attachment) =>
            issueAttachmentService.uploadIssueAttachment(
              workspaceSlug.toString(),
              responseProjectId,
              response.id,
              attachment.file,
              (progressEvent) => {
                const progress = Math.round((progressEvent.progress ?? 0) * 100);
                setPendingAttachments((currentAttachments) =>
                  currentAttachments.map((currentAttachment) =>
                    currentAttachment.id === attachment.id
                      ? { ...currentAttachment, progress, status: "uploading" }
                      : currentAttachment
                  )
                );
              }
            )
          )
        );
        failedAttachmentUploads = uploadResults.filter((result) => result.status === "rejected").length;
        setPendingAttachments([]);
      }

      // create sub work item after the issue exists
      if (response.id && response.project_id) {
        await handleCreateSubWorkItem({
          workspaceSlug: workspaceSlug?.toString(),
          projectId: response.project_id,
          parentId: response.id,
        });
      }

      setToast({
        type: failedAttachmentUploads > 0 ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
        title: t("success"),
        message:
          failedAttachmentUploads > 0
            ? t("attachment.upload_failed_after_create")
            : `${is_draft_issue ? t("draft_created") : t("issue_created_successfully")} `,
        actionItems: !is_draft_issue && response?.project_id && (
          <CreateIssueToastActionItems
            workspaceSlug={workspaceSlug.toString()}
            projectId={response?.project_id}
            issueId={response.id}
          />
        ),
      });
      if (!createMore) handleClose();
      if (createMore && issueTitleRef) issueTitleRef?.current?.focus();
      setDescription("<p></p>");
      setChangesMade(null);
      return response;
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message:
          getStateTransitionErrorMessage(error) ??
          error?.error ??
          t(is_draft_issue ? "draft_creation_failed" : "issue_creation_failed"),
      });
      throw error;
    }
  };

  const handleUpdateIssue = async (payload: Partial<TIssue>): Promise<TIssue | undefined> => {
    if (!workspaceSlug || !payload.project_id || !data?.id) return;

    try {
      if (isDraft) await draftIssues.updateIssue(workspaceSlug.toString(), data.id, payload);
      else if (updateIssue) await updateIssue(payload.project_id, data.id, payload);

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t("issue_updated_successfully"),
        actionItems:
          showActionItemsOnUpdate && payload.project_id ? (
            <CreateIssueToastActionItems
              workspaceSlug={workspaceSlug.toString()}
              projectId={payload.project_id}
              issueId={data.id}
            />
          ) : undefined,
      });
      handleClose();
    } catch (error: any) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: getStateTransitionErrorMessage(error) ?? error?.error ?? t("issue_could_not_be_updated"),
      });
    }
  };

  const handleFormSubmit = async (payload: Partial<TIssue>, is_draft_issue: boolean = false) => {
    if (!workspaceSlug || !payload.project_id || !storeType) return;
    // remove sourceIssueId from payload since it is not needed
    if (data?.sourceIssueId) delete data.sourceIssueId;

    let response: TIssue | undefined = undefined;

    try {
      if (beforeFormSubmit) await beforeFormSubmit();
      if (!data?.id) response = await handleCreateIssue(payload, is_draft_issue);
      else response = await handleUpdateIssue(payload);
    } finally {
      if (response != undefined && onSubmit) await onSubmit(response);
    }
  };

  const handleFormChange = (formData: Partial<TIssue> | null) => setChangesMade(formData);

  const handleUpdateUploadedAssetIds = (assetId: string) => setUploadedAssetIds((prev) => [...prev, assetId]);

  const handlePendingAttachmentsAdd = (files: File[]) => {
    setPendingAttachments((currentAttachments) => {
      const existingFileKeys = new Set(
        currentAttachments.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`)
      );
      const newAttachments = files
        .filter((file) => !existingFileKeys.has(`${file.name}:${file.size}:${file.lastModified}`))
        .map((file) => ({
          id: uuidv4(),
          file,
          progress: 0,
          status: "queued" as const,
        }));
      return [...currentAttachments, ...newAttachments];
    });
  };

  const handlePendingAttachmentRemove = (attachmentId: string) =>
    setPendingAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    );

  const handleDuplicateIssueModal = (value: boolean) => setIsDuplicateModalOpen(value);

  // don't open the modal if there are no projects
  if (!allowedProjectIds || allowedProjectIds.length === 0 || !activeProjectId) return null;

  const commonIssueModalProps: IssueFormProps = {
    issueTitleRef: issueTitleRef,
    data: {
      ...data,
      description_html: description,
      cycle_id: data?.cycle_id ? data?.cycle_id : cycleId ? cycleId.toString() : null,
      module_ids: data?.module_ids ? data?.module_ids : moduleId ? [moduleId.toString()] : null,
    },
    onAssetUpload: handleUpdateUploadedAssetIds,
    pendingAttachments,
    onPendingAttachmentsAdd: handlePendingAttachmentsAdd,
    onPendingAttachmentRemove: handlePendingAttachmentRemove,
    onPendingAttachmentsClear: () => setPendingAttachments([]),
    onClose: handleClose,
    onSubmit: (payload) => handleFormSubmit(payload, isDraft),
    projectId: activeProjectId,
    isCreateMoreToggleEnabled: createMore,
    onCreateMoreToggleChange: handleCreateMoreToggleChange,
    isDraft: isDraft,
    moveToIssue: moveToIssue,
    modalTitle: modalTitle,
    primaryButtonText: primaryButtonText,
    isDuplicateModalOpen: isDuplicateModalOpen,
    handleDuplicateIssueModal: handleDuplicateIssueModal,
    isProjectSelectionDisabled: isProjectSelectionDisabled,
  };

  return (
    <ModalCore
      isOpen={isOpen}
      position={EModalPosition.TOP}
      width={isDuplicateModalOpen ? EModalWidth.VIXL : EModalWidth.XXXXL}
      className="rounded-lg !bg-transparent shadow-none transition-[width] ease-linear"
    >
      {withDraftIssueWrapper ? (
        <DraftIssueLayout {...commonIssueModalProps} changesMade={changesMade} onChange={handleFormChange} />
      ) : (
        <IssueFormRoot {...commonIssueModalProps} />
      )}
    </ModalCore>
  );
});
