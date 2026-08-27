/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Send,
  Upload,
  X,
} from "lucide-react";
import type { TIssue, TIssueAttachment, TIssueComment, TProjectWorkItemProperty } from "@plane/types";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { IssueAttachmentService, IssueCommentService, IssueService } from "@/services/issue";
import { ProjectService } from "@/services/project";
import type { TLabels } from "./page";

const issueService = new IssueService();
const commentService = new IssueCommentService();
const attachmentService = new IssueAttachmentService();
const projectService = new ProjectService();

type TProps = {
  issueSummary: TIssue;
  labels: TLabels;
  workspaceSlug: string;
  onBack: () => void;
  onIssueUpdated: () => void;
};

function htmlToText(value?: string) {
  if (!value) return "";
  const element = document.createElement("div");
  element.innerHTML = value.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  return (element.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function attachmentKind(attachment: TIssueAttachment) {
  const mime = (attachment.attributes.type || "").toLowerCase();
  const name = attachment.attributes.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/.test(name)) return "audio";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "file";
}

function AttachmentIcon({ attachment }: { attachment: TIssueAttachment }) {
  const kind = attachmentKind(attachment);
  if (kind === "image") return <FileImage aria-hidden="true" />;
  if (kind === "video") return <FileVideo aria-hidden="true" />;
  if (kind === "audio") return <FileAudio aria-hidden="true" />;
  if (kind === "pdf") return <FileText aria-hidden="true" />;
  return <File aria-hidden="true" />;
}

const TelegramIssueDetailComponent = observer(function TelegramIssueDetailComponent({
  issueSummary,
  labels,
  workspaceSlug,
  onBack,
  onIssueUpdated,
}: TProps) {
  const { getProjectById } = useProject();
  const { getStateById } = useProjectState();
  const { getUserDetails } = useMember();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [issue, setIssue] = useState<TIssue>(issueSummary);
  const [comments, setComments] = useState<TIssueComment[]>([]);
  const [attachments, setAttachments] = useState<TIssueAttachment[]>([]);
  const [customProperties, setCustomProperties] = useState<TProjectWorkItemProperty[]>([]);
  const [comment, setComment] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TIssueAttachment | null>(null);

  const projectId = issueSummary.project_id || "";
  const project = getProjectById(projectId);
  const state = getStateById(issue.state_id);
  const identifier = project?.identifier ? `${project.identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`;

  const userName = useCallback(
    (userId?: string | null) => {
      if (!userId) return labels.noValue;
      const member = getUserDetails(userId);
      return (
        [member?.first_name, member?.last_name].filter(Boolean).join(" ") || member?.display_name || labels.noValue
      );
    },
    [getUserDetails, labels.noValue]
  );

  const loadDetail = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [issueResponse, commentResponse, attachmentResponse, propertyResponse] = await Promise.all([
        issueService.retrieve(workspaceSlug, projectId, issueSummary.id),
        commentService.getIssueComments(workspaceSlug, projectId, issueSummary.id),
        attachmentService.getIssueAttachments(workspaceSlug, projectId, issueSummary.id),
        projectService.getWorkItemProperties(workspaceSlug, projectId),
      ]);
      setIssue(issueResponse);
      setComments(commentResponse);
      setAttachments(attachmentResponse);
      setCustomProperties(propertyResponse.filter((property) => !property.archived_at));
    } catch {
      setError(labels.loadDetailError);
    } finally {
      setIsLoading(false);
    }
  }, [issueSummary.id, labels.loadDetailError, projectId, workspaceSlug]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const telegramBackButton = window.Telegram?.WebApp?.BackButton;
    telegramBackButton?.show();
    telegramBackButton?.onClick(onBack);
    return () => {
      telegramBackButton?.offClick(onBack);
      telegramBackButton?.hide();
    };
  }, [onBack]);

  const priorityLabel =
    labels[(issue.priority || "none") as keyof Pick<TLabels, "low" | "medium" | "high" | "urgent" | "none">];

  const renderPropertyValue = (property: TProjectWorkItemProperty) => {
    const value = issue.property_values?.[property.id];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length))
      return labels.noValue;
    if (property.property_type === "CHECKBOX") return value ? "✓" : "—";
    const values = Array.isArray(value) ? value : [value];
    if (property.select_source === "MEMBERS") return values.map((item) => userName(String(item))).join(", ");
    if (property.property_type === "SINGLE_SELECT" || property.property_type === "MULTI_SELECT")
      return values
        .map((item) => property.options.find((option) => option.id === String(item))?.name || String(item))
        .join(", ");
    if (property.property_type === "DATE")
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${String(value)}T00:00:00`));
    return Array.isArray(value) ? value.join(", ") : String(value);
  };

  const sendComment = async () => {
    const value = comment.trim();
    if (!value || isSending || !projectId) return;
    setIsSending(true);
    setError(null);
    const paragraphs = value.split(/\n{2,}/).map((paragraph) => paragraph.split("\n"));
    const commentHtml = paragraphs
      .map((lines) => `<p>${lines.map((line) => escapeHtml(line)).join("<br>")}</p>`)
      .join("");
    const commentJson = {
      type: "doc",
      content: paragraphs.map((lines) => ({
        type: "paragraph",
        content: [{ type: "text", text: lines.join("\n") }],
      })),
    };
    try {
      const createdComment = await commentService.createIssueComment(workspaceSlug, projectId, issue.id, {
        comment_html: commentHtml,
        comment_json: commentJson,
      });
      setComments((current) => [...current, createdComment]);
      setComment("");
    } catch {
      setError(labels.commentError);
    } finally {
      setIsSending(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !projectId) return;
    setIsUploading(true);
    setError(null);
    const results = await Promise.allSettled(
      Array.from(files).map((file) => attachmentService.uploadIssueAttachment(workspaceSlug, projectId, issue.id, file))
    );
    const uploaded = results
      .filter((result): result is PromiseFulfilledResult<TIssueAttachment> => result.status === "fulfilled")
      .map((result) => result.value);
    setAttachments((current) => [...current, ...uploaded]);
    setIssue((current) => ({ ...current, attachment_count: current.attachment_count + uploaded.length }));
    if (results.some((result) => result.status === "rejected")) setError(labels.uploadError);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsUploading(false);
    if (uploaded.length) onIssueUpdated();
  };

  const dateRange = useMemo(() => {
    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(
        new Date(`${value}T00:00:00`)
      );
    if (issue.start_date && issue.target_date) return `${format(issue.start_date)} — ${format(issue.target_date)}`;
    if (issue.target_date) return format(issue.target_date);
    if (issue.start_date) return format(issue.start_date);
    return labels.noValue;
  }, [issue.start_date, issue.target_date, labels.noValue]);

  if (isLoading)
    return (
      <main className="tg-mini-app tg-mini-app--centered">
        <LoaderCircle className="tg-spin" aria-label="Loading" />
      </main>
    );

  if (error === labels.loadDetailError)
    return (
      <main className="tg-mini-app tg-mini-app--centered">
        <div className="tg-list-state">
          <strong>{error}</strong>
          <button type="button" onClick={onBack}>
            {labels.back}
          </button>
        </div>
      </main>
    );

  return (
    <main className="tg-mini-app tg-detail-page">
      <header className="tg-detail-header">
        <button type="button" onClick={onBack} aria-label={labels.back}>
          <ArrowLeft aria-hidden="true" size={20} />
        </button>
        <div>
          <span>{identifier}</span>
          <strong>{project?.name}</strong>
        </div>
      </header>

      <article className="tg-detail-content">
        <section className="tg-detail-hero">
          <span className="tg-state-pill">
            <span style={{ backgroundColor: state?.color || "var(--tg-app-muted)" }} />
            {state?.name || labels.noStatus}
          </span>
          <h1>{issue.name}</h1>
          {htmlToText(issue.description_html) && <p>{htmlToText(issue.description_html)}</p>}
        </section>

        <section className="tg-detail-section">
          <h2>{labels.properties}</h2>
          <dl className="tg-property-grid">
            <div>
              <dt>{labels.status}</dt>
              <dd>{state?.name || labels.noStatus}</dd>
            </div>
            <div>
              <dt>{labels.priority}</dt>
              <dd>{priorityLabel}</dd>
            </div>
            <div>
              <dt>{labels.assignees}</dt>
              <dd>{issue.assignee_ids?.length ? issue.assignee_ids.map(userName).join(", ") : labels.noValue}</dd>
            </div>
            <div>
              <dt>{labels.createdBy}</dt>
              <dd>{userName(issue.created_by)}</dd>
            </div>
            <div className="tg-property-grid__wide">
              <dt>{labels.dates}</dt>
              <dd>
                <CalendarDays size={14} aria-hidden="true" />
                {dateRange}
              </dd>
            </div>
          </dl>
        </section>

        {customProperties.length > 0 && (
          <section className="tg-detail-section">
            <h2>{labels.customFields}</h2>
            <dl className="tg-custom-properties">
              {customProperties.map((property) => (
                <div key={property.id}>
                  <dt>{property.name}</dt>
                  <dd>{renderPropertyValue(property)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="tg-detail-section">
          <div className="tg-section-heading">
            <h2>
              <Paperclip size={17} aria-hidden="true" />
              {labels.attachmentsTitle} · {attachments.length}
            </h2>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              {isUploading ? <LoaderCircle className="tg-spin" size={15} /> : <Upload size={15} />}
              {labels.addFiles}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => uploadFiles(event.target.files)}
            />
          </div>
          <div className="tg-attachment-list">
            {attachments.map((attachment) => {
              const kind = attachmentKind(attachment);
              const previewable = kind !== "file";
              const content = (
                <>
                  <AttachmentIcon attachment={attachment} />
                  <span>
                    <strong>{attachment.attributes.name}</strong>
                    <small>{formatBytes(attachment.attributes.size)}</small>
                  </span>
                  {previewable ? <span>{labels.open}</span> : <Download size={16} aria-hidden="true" />}
                </>
              );
              return previewable ? (
                <button key={attachment.id} type="button" onClick={() => setPreview(attachment)}>
                  {content}
                </button>
              ) : (
                <a key={attachment.id} href={attachment.asset_url} target="_blank" rel="noreferrer" download>
                  {content}
                </a>
              );
            })}
          </div>
        </section>

        <section className="tg-detail-section">
          <h2>
            <MessageCircle size={17} aria-hidden="true" />
            {labels.commentsTitle} · {comments.length}
          </h2>
          <div className="tg-comment-list">
            {comments.length ? (
              comments.map((item) => {
                const actorName =
                  [item.actor_detail?.first_name, item.actor_detail?.last_name].filter(Boolean).join(" ") ||
                  item.actor_detail?.display_name ||
                  labels.noValue;
                return (
                  <article key={item.id}>
                    <header>
                      <strong>{actorName}</strong>
                      <time>
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                          new Date(item.created_at)
                        )}
                      </time>
                    </header>
                    <p>{item.comment_stripped || htmlToText(item.comment_html)}</p>
                  </article>
                );
              })
            ) : (
              <p className="tg-empty-copy">{labels.noComments}</p>
            )}
          </div>
          <div className="tg-comment-composer">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  sendComment();
                }
              }}
              rows={3}
              placeholder={labels.commentPlaceholder}
            />
            <button type="button" onClick={sendComment} disabled={!comment.trim() || isSending}>
              {isSending ? <LoaderCircle className="tg-spin" size={16} /> : <Send size={16} />}
              {labels.send}
            </button>
          </div>
          {error && error !== labels.loadDetailError && <p className="tg-inline-error">{error}</p>}
        </section>
      </article>

      {preview && (
        <div className="tg-preview" role="dialog" aria-modal="true" aria-label={preview.attributes.name}>
          <header>
            <strong>{preview.attributes.name}</strong>
            <button type="button" onClick={() => setPreview(null)} aria-label={labels.close}>
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="tg-preview__content">
            {attachmentKind(preview) === "image" && <img src={preview.asset_url} alt={preview.attributes.name} />}
            {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- previewing an arbitrary user attachment */}
            {attachmentKind(preview) === "video" && <video src={preview.asset_url} controls playsInline />}
            {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- previewing an arbitrary user attachment */}
            {attachmentKind(preview) === "audio" && <audio src={preview.asset_url} controls />}
            {attachmentKind(preview) === "pdf" && (
              <iframe
                src={preview.asset_url}
                title={preview.attributes.name}
                sandbox="allow-same-origin allow-downloads"
              />
            )}
          </div>
          <a href={preview.asset_url} target="_blank" rel="noreferrer" download>
            <Download size={16} aria-hidden="true" />
            {labels.download}
          </a>
        </div>
      )}
    </main>
  );
});

export const TelegramIssueDetail = TelegramIssueDetailComponent;
