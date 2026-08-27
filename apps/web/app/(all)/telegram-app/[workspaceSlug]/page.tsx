/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { TIssue, TIssuesResponse } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserProfile } from "@/hooks/store/user";
import { WorkspaceService } from "@/services/workspace.service";
import gtsSphereLogo from "@/app/assets/logos/gts-sphere.svg?url";
import { TelegramIssueDetail } from "./issue-detail";

type TTaskTab = "assigned" | "created" | "all";

const translations = {
  ru: {
    tasks: "Задачи",
    assigned: "Назначенные мне",
    created: "Созданные мной",
    all: "Все доступные",
    newTask: "Новая задача",
    empty: "Здесь пока нет задач",
    emptyHint: "Переключите раздел или создайте новую задачу.",
    loadMore: "Показать ещё",
    retry: "Повторить",
    loadError: "Не удалось загрузить задачи.",
    comments: "комм.",
    attachments: "файлов",
    noStatus: "Без статуса",
    workspace: "Рабочее пространство",
    back: "Назад к задачам",
    description: "Описание",
    properties: "Свойства",
    status: "Статус",
    priority: "Приоритет",
    assignees: "Исполнители",
    createdBy: "Создал",
    dates: "Сроки",
    customFields: "Поля проекта",
    noValue: "Не указано",
    commentsTitle: "Комментарии",
    commentPlaceholder: "Напишите комментарий…",
    send: "Отправить",
    attachmentsTitle: "Файлы",
    addFiles: "Добавить файлы",
    uploadError: "Не удалось загрузить файл.",
    commentError: "Не удалось отправить комментарий.",
    loadDetailError: "Не удалось открыть задачу.",
    noComments: "Комментариев пока нет.",
    open: "Открыть",
    download: "Скачать",
    close: "Закрыть",
    low: "Низкий",
    medium: "Средний",
    high: "Высокий",
    urgent: "Срочный",
    none: "Без приоритета",
  },
  en: {
    tasks: "Tasks",
    assigned: "Assigned to me",
    created: "Created by me",
    all: "All available",
    newTask: "New task",
    empty: "No tasks here yet",
    emptyHint: "Switch the section or create a new task.",
    loadMore: "Load more",
    retry: "Try again",
    loadError: "Tasks could not be loaded.",
    comments: "comments",
    attachments: "files",
    noStatus: "No status",
    workspace: "Workspace",
    back: "Back to tasks",
    description: "Description",
    properties: "Properties",
    status: "Status",
    priority: "Priority",
    assignees: "Assignees",
    createdBy: "Created by",
    dates: "Dates",
    customFields: "Project fields",
    noValue: "Not set",
    commentsTitle: "Comments",
    commentPlaceholder: "Write a comment…",
    send: "Send",
    attachmentsTitle: "Files",
    addFiles: "Add files",
    uploadError: "The file could not be uploaded.",
    commentError: "The comment could not be sent.",
    loadDetailError: "The task could not be opened.",
    noComments: "No comments yet.",
    open: "Open",
    download: "Download",
    close: "Close",
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
    none: "No priority",
  },
  uz: {
    tasks: "Vazifalar",
    assigned: "Menga tayinlangan",
    created: "Men yaratgan",
    all: "Barcha mavjud",
    newTask: "Yangi vazifa",
    empty: "Bu yerda hali vazifalar yo‘q",
    emptyHint: "Bo‘limni almashtiring yoki yangi vazifa yarating.",
    loadMore: "Yana ko‘rsatish",
    retry: "Qayta urinish",
    loadError: "Vazifalarni yuklab bo‘lmadi.",
    comments: "izoh",
    attachments: "fayl",
    noStatus: "Statussiz",
    workspace: "Ish maydoni",
    back: "Vazifalarga qaytish",
    description: "Tavsif",
    properties: "Xususiyatlar",
    status: "Status",
    priority: "Ustuvorlik",
    assignees: "Ijrochilar",
    createdBy: "Yaratuvchi",
    dates: "Muddatlar",
    customFields: "Loyiha maydonlari",
    noValue: "Ko‘rsatilmagan",
    commentsTitle: "Izohlar",
    commentPlaceholder: "Izoh yozing…",
    send: "Yuborish",
    attachmentsTitle: "Fayllar",
    addFiles: "Fayllarni qo‘shish",
    uploadError: "Faylni yuklab bo‘lmadi.",
    commentError: "Izohni yuborib bo‘lmadi.",
    loadDetailError: "Vazifani ochib bo‘lmadi.",
    noComments: "Hozircha izohlar yo‘q.",
    open: "Ochish",
    download: "Yuklab olish",
    close: "Yopish",
    low: "Past",
    medium: "O‘rta",
    high: "Yuqori",
    urgent: "Shoshilinch",
    none: "Ustuvorliksiz",
  },
};

export type TLabels = Record<keyof (typeof translations)["en"], string>;

const workspaceService = new WorkspaceService();

function flattenIssues(value: TIssuesResponse["results"]): TIssue[] {
  if (Array.isArray(value)) return value as TIssue[];
  return Object.values(value ?? {}).flatMap((entry) => {
    if (Array.isArray(entry)) return entry as TIssue[];
    if (entry && typeof entry === "object" && "results" in entry) return flattenIssues(entry.results as never);
    return [];
  });
}

function languageKey(value?: string) {
  const language = (value || (typeof navigator === "undefined" ? "en" : navigator.language))
    .toLowerCase()
    .split("-", 1)[0];
  return language === "ru" || language === "uz" ? language : "en";
}

function Avatar({ memberId }: { memberId: string }) {
  const { getUserDetails } = useMember();
  const member = getUserDetails(memberId);
  const name = [member?.first_name, member?.last_name].filter(Boolean).join(" ") || member?.display_name || "?";
  return (
    <span className="tg-avatar" title={name}>
      {member?.avatar_url ? <img src={member.avatar_url} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function TaskCard({ issue, labels, onOpen }: { issue: TIssue; labels: TLabels; onOpen: () => void }) {
  const { getProjectById } = useProject();
  const { getStateById } = useProjectState();
  const project = getProjectById(issue.project_id);
  const state = getStateById(issue.state_id);
  const identifier = project?.identifier ? `${project.identifier}-${issue.sequence_id}` : `#${issue.sequence_id}`;
  const visibleAssignees = (issue.assignee_ids ?? []).slice(0, 3);
  const extraAssignees = Math.max(0, (issue.assignee_ids?.length ?? 0) - visibleAssignees.length);

  return (
    <button className="tg-task-card" type="button" onClick={onOpen}>
      <span className="tg-task-card__rail" style={{ backgroundColor: state?.color || "var(--tg-app-accent)" }} />
      <span className="tg-task-card__topline">
        <span className="tg-task-key">{identifier}</span>
        <span className="tg-task-project">{project?.name}</span>
      </span>
      <strong className="tg-task-title">{issue.name}</strong>
      <span className="tg-task-card__meta">
        <span className="tg-state-pill">
          <span style={{ backgroundColor: state?.color || "var(--tg-app-muted)" }} />
          {state?.name || labels.noStatus}
        </span>
        {issue.target_date && (
          <span className="tg-meta-item">
            <CalendarDays size={13} aria-hidden="true" />
            {new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" }).format(
              new Date(`${issue.target_date}T00:00:00`)
            )}
          </span>
        )}
        {issue.attachment_count > 0 && (
          <span className="tg-meta-item" title={`${issue.attachment_count} ${labels.attachments}`}>
            <Paperclip size={13} aria-hidden="true" />
            {issue.attachment_count}
          </span>
        )}
        {issue.sub_issues_count > 0 && (
          <span className="tg-meta-item">
            <ClipboardList size={13} aria-hidden="true" />
            {issue.sub_issues_count}
          </span>
        )}
        <span className="tg-task-assignees">
          {visibleAssignees.map((memberId) => (
            <Avatar key={memberId} memberId={memberId} />
          ))}
          {extraAssignees > 0 && <span className="tg-avatar tg-avatar--more">+{extraAssignees}</span>}
        </span>
      </span>
    </button>
  );
}

const TelegramMiniAppPage = observer(function TelegramMiniAppPage() {
  const { workspaceSlug } = useParams();
  const { data: currentUser, projectsWithCreatePermissions } = useUser();
  const { data: userProfile } = useUserProfile();
  const { workspaces } = useWorkspace();
  const labels = translations[languageKey(userProfile?.language)];
  const currentSlug = workspaceSlug?.toString() ?? "";
  const workspaceList = Object.values(workspaces ?? {});
  const currentWorkspace = workspaceList.find((workspace) => workspace.slug === currentSlug);
  const allowedProjectIds = Object.keys(projectsWithCreatePermissions ?? {});

  const [activeTab, setActiveTab] = useState<TTaskTab>("assigned");
  const [issues, setIssues] = useState<TIssue[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<TIssue | null>(null);

  const tabItems = useMemo(
    () => [
      { id: "assigned" as const, label: labels.assigned },
      { id: "created" as const, label: labels.created },
      { id: "all" as const, label: labels.all },
    ],
    [labels]
  );

  const loadIssues = useCallback(
    async (cursor?: string) => {
      if (!currentSlug || !currentUser?.id) return;
      if (cursor) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(false);
      const params: Record<string, string | number> = {
        cursor: cursor || "50:0:0",
        per_page: 50,
        order_by: "-updated_at",
      };
      if (activeTab === "assigned") params.assignees = currentUser.id;
      if (activeTab === "created") params.created_by = currentUser.id;
      try {
        const response = await workspaceService.getViewIssues(currentSlug, params);
        const pageIssues = flattenIssues(response.results);
        setIssues((current) => (cursor ? [...current, ...pageIssues] : pageIssues));
        setNextCursor(response.next_page_results ? response.next_cursor : null);
      } catch {
        setError(true);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [activeTab, currentSlug, currentUser?.id]
  );

  useEffect(() => {
    setIssues([]);
    setNextCursor(null);
    loadIssues();
  }, [loadIssues, refreshKey]);

  const switchWorkspace = (slug: string) => {
    if (slug === currentSlug) return setWorkspaceMenuOpen(false);
    window.location.assign(`/telegram-app/${encodeURIComponent(slug)}`);
  };

  if (selectedIssue)
    return (
      <TelegramIssueDetail
        issueSummary={selectedIssue}
        labels={labels}
        workspaceSlug={currentSlug}
        onBack={() => setSelectedIssue(null)}
        onIssueUpdated={() => setRefreshKey((value) => value + 1)}
      />
    );

  return (
    <main className="tg-mini-app tg-tasks-page">
      <CreateUpdateIssueModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={async () => setRefreshKey((value) => value + 1)}
        storeType={EIssuesStoreType.PROJECT}
        withDraftIssueWrapper={false}
        allowedProjectIds={allowedProjectIds}
        data={allowedProjectIds[0] ? { project_id: allowedProjectIds[0] } : undefined}
        moveToIssue={false}
      />
      <header className="tg-app-header">
        <div className="tg-app-header__brand">
          <img src={gtsSphereLogo} alt="" />
          <div>
            <span>GTS Tasks</span>
            <strong>{labels.tasks}</strong>
          </div>
        </div>
        <button
          className="tg-create-button"
          type="button"
          onClick={() => setCreateModalOpen(true)}
          disabled={allowedProjectIds.length === 0}
          aria-label={labels.newTask}
        >
          <Plus size={20} aria-hidden="true" />
          <span>{labels.newTask}</span>
        </button>
      </header>

      <div className="tg-workspace-picker">
        <button
          className="tg-workspace-picker__trigger"
          type="button"
          onClick={() => setWorkspaceMenuOpen((value) => !value)}
          aria-expanded={workspaceMenuOpen}
        >
          <span>
            <small>{labels.workspace}</small>
            <strong>{currentWorkspace?.name || currentSlug}</strong>
          </span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>
        {workspaceMenuOpen && (
          <div className="tg-workspace-menu">
            {workspaceList.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={workspace.slug === currentSlug ? "is-active" : undefined}
                onClick={() => switchWorkspace(workspace.slug)}
              >
                <span>{workspace.name.slice(0, 1).toUpperCase()}</span>
                {workspace.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="tg-tab-list" aria-label={labels.tasks}>
        {tabItems.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "is-active" : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="tg-task-list" aria-live="polite">
        {isLoading ? (
          <div className="tg-list-state">
            <LoaderCircle className="tg-spin" aria-hidden="true" />
          </div>
        ) : error ? (
          <div className="tg-list-state">
            <AlertCircle aria-hidden="true" />
            <strong>{labels.loadError}</strong>
            <button type="button" onClick={() => loadIssues()}>
              <RefreshCw size={15} aria-hidden="true" />
              {labels.retry}
            </button>
          </div>
        ) : issues.length === 0 ? (
          <div className="tg-list-state tg-list-state--empty">
            <MessageCircle aria-hidden="true" />
            <strong>{labels.empty}</strong>
            <p>{labels.emptyHint}</p>
          </div>
        ) : (
          <>
            {issues.map((issue) => (
              <TaskCard key={issue.id} issue={issue} labels={labels} onOpen={() => setSelectedIssue(issue)} />
            ))}
            {nextCursor && (
              <button
                className="tg-load-more"
                type="button"
                onClick={() => loadIssues(nextCursor)}
                disabled={isLoadingMore}
              >
                {isLoadingMore && <LoaderCircle className="tg-spin" size={16} aria-hidden="true" />}
                {labels.loadMore}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
});

export default TelegramMiniAppPage;
