/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
// plane imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// services
import { FileService } from "@/services/file.service";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentsOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
};

// services
const fileService = new FileService();

type TMentionAccessError = {
  code?: string;
  user_ids?: string[];
  can_grant?: string | boolean;
};

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
  } = props;
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  const [pendingMentionGrant, setPendingMentionGrant] = useState<{
    formData: Partial<TIssueComment>;
    userIds: string[];
  } | null>(null);
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  // store hooks
  const workspaceStore = useWorkspace();
  const {
    issue: { getIssueById },
    updateIssue,
  } = useIssueDetail();
  const { t } = useTranslation();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TIssueComment>>({
    defaultValues: {
      comment_html: "<p></p>",
    },
  });

  const completeCommentSubmission = async (formData: Partial<TIssueComment>) => {
    const comment = await activityOperations.createComment(formData);
    if (comment?.id) onSubmitCallback?.(comment.id);
    if (uploadedAssetIds.length > 0) {
      if (projectId) {
        await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
          asset_ids: uploadedAssetIds,
        });
      } else {
        await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
          asset_ids: uploadedAssetIds,
        });
      }
      setUploadedAssetIds([]);
    }
    setPendingMentionGrant(null);
    reset({ comment_html: "<p></p>" });
    editorRef.current?.clearEditor();
  };

  const onSubmit = async (formData: Partial<TIssueComment>) => {
    try {
      await completeCommentSubmission(formData);
    } catch (error) {
      const mentionError = (error as { mentions?: TMentionAccessError })?.mentions;
      if (mentionError?.code === "restricted_task_access_required") {
        const userIds = Array.isArray(mentionError.user_ids) ? mentionError.user_ids : [];
        const canGrant = mentionError.can_grant === true || mentionError.can_grant === "true";
        if (canGrant && userIds.length > 0) {
          setPendingMentionGrant({ formData, userIds });
          return;
        }
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("issue.access.mention_blocked_title"),
          message: t("issue.access.mention_blocked_description"),
        });
        return;
      }
      console.error(error);
    }
  };

  const grantMentionAccessAndSubmit = async () => {
    if (!pendingMentionGrant || !projectId) return;
    const issue = getIssueById(entityId);
    if (!issue) return;
    const assigneeIds = Array.from(new Set([...(issue.assignee_ids ?? []), ...pendingMentionGrant.userIds]));
    try {
      await updateIssue(workspaceSlug, projectId, entityId, { assignee_ids: assigneeIds });
      await completeCommentSubmission(pendingMentionGrant.formData);
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("common.error.label"),
        message: t("issue.access.grant_failed"),
      });
    }
  };

  const commentHTML = watch("comment_html");
  const isEmpty = isCommentEmpty(commentHTML ?? undefined);

  return (
    <div
      className={cn("sticky bottom-0 z-[4] bg-surface-1 sm:static")}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          (e.ctrlKey || e.metaKey) &&
          !isEmpty &&
          !isSubmitting &&
          editorRef.current?.isEditorReadyToDiscard()
        ) {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit(onSubmit)(e);
        }
      }}
    >
      <Controller
        name="access"
        control={control}
        render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
          <Controller
            name="comment_html"
            control={control}
            render={({ field: { value, onChange } }) => (
              <LiteTextEditor
                editable
                workspaceId={workspaceId}
                id={"add_comment_" + entityId}
                value={"<p></p>"}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                onEnterKeyPress={(e) => {
                  if (!isEmpty && !isSubmitting) {
                    handleSubmit(onSubmit)(e);
                  }
                }}
                disabledExtensions={["enter-key"]}
                ref={editorRef}
                initialValue={value ?? "<p></p>"}
                containerClassName="min-h-min"
                onChange={(comment_json, comment_html) => onChange(comment_html)}
                accessSpecifier={accessValue ?? EIssueCommentAccessSpecifier.INTERNAL}
                handleAccessChange={onAccessChange}
                isSubmitting={isSubmitting}
                uploadFile={async (blockId, file) => {
                  const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                duplicateFile={async (assetId: string) => {
                  const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                showToolbarInitially={showToolbarInitially}
                parentClassName="p-2"
                displayConfig={{
                  fontSize: "small-font",
                }}
              />
            )}
          />
        )}
      />
      {pendingMentionGrant && (
        <div className="mx-2 mb-2 rounded-lg border border-warning-subtle bg-warning-subtle/40 p-3">
          <p className="text-body-xs-medium text-primary">{t("issue.access.grant_before_mention_title")}</p>
          <p className="mt-1 text-caption-sm-regular text-secondary">
            {t("issue.access.grant_before_mention_description", { count: pendingMentionGrant.userIds.length })}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingMentionGrant(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={grantMentionAccessAndSubmit} loading={isSubmitting}>
              {t("issue.access.grant_and_send")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
