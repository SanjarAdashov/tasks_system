import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Archive, Pencil, Plus, RotateCcw, Trash2, UserRound, UsersRound } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectUserGroup, TProjectUserGroupMember } from "@plane/types";
import { Avatar, Checkbox, EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { cn, getFileURL, getUserFullName, getUserSearchText } from "@plane/utils";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useMember } from "@/hooks/store/use-member";
import { useUserPermissions } from "@/hooks/store/user";
import { ProjectService } from "@/services/project";
import type { Route } from "./+types/page";

const service = new ProjectService();

type TGroupsTab = "active" | "archived";
type TEditorState = { mode: "create"; group: null } | { mode: "edit"; group: TProjectUserGroup };
type TGroupAction = "archive" | "restore" | "delete";
type TActionState = { action: TGroupAction; group: TProjectUserGroup };

function UserGroupsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const { project: projectMembers, getUserDetails } = useMember();
  const canManage = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const [activeTab, setActiveTab] = useState<TGroupsTab>("active");
  const [editorState, setEditorState] = useState<TEditorState | null>(null);
  const [actionState, setActionState] = useState<TActionState | null>(null);
  const { data: groups, mutate } = useSWR(
    canManage ? ["PROJECT_USER_GROUPS", workspaceSlug, projectId, true] : null,
    () => service.getUserGroups(workspaceSlug, projectId, true)
  );

  useEffect(() => {
    void projectMembers.fetchProjectMembers(workspaceSlug, projectId);
  }, [workspaceSlug, projectId, projectMembers]);

  const memberIds = (projectMembers.getProjectMemberIds(projectId, false) ?? []).filter(
    (memberId) => getUserDetails(memberId)?.is_active
  );
  const activeGroups = useMemo(() => groups?.filter((group) => !group.archived_at) ?? [], [groups]);
  const archivedGroups = useMemo(() => groups?.filter((group) => Boolean(group.archived_at)) ?? [], [groups]);
  const displayedGroups = activeTab === "active" ? activeGroups : archivedGroups;

  if (!canManage) return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;

  return (
    <SettingsContentWrapper>
      <SettingsHeading
        title={t("project_settings.user_groups.heading")}
        description={t("project_settings.user_groups.description")}
      />

      <div className="space-y-5 p-6">
        <div className="flex flex-col gap-3 border-b border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-subtle bg-layer-1 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "active"}
              onClick={() => setActiveTab("active")}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-13 font-medium transition-colors",
                activeTab === "active"
                  ? "bg-layer-2 text-primary shadow-raised-100"
                  : "text-secondary hover:text-primary"
              )}
            >
              {t("project_settings.user_groups.active_tab")}
              <span className="rounded-full bg-layer-3 px-2 py-0.5 text-11 text-secondary">{activeGroups.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "archived"}
              onClick={() => setActiveTab("archived")}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-13 font-medium transition-colors",
                activeTab === "archived"
                  ? "bg-layer-2 text-primary shadow-raised-100"
                  : "text-secondary hover:text-primary"
              )}
            >
              {t("project_settings.user_groups.archived_tab")}
              <span className="rounded-full bg-layer-3 px-2 py-0.5 text-11 text-secondary">
                {archivedGroups.length}
              </span>
            </button>
          </div>

          <Button size="xl" onClick={() => setEditorState({ mode: "create", group: null })}>
            <Plus className="size-4" />
            {t("project_settings.user_groups.create")}
          </Button>
        </div>

        {!groups ? (
          <GroupsSkeleton />
        ) : displayedGroups.length > 0 ? (
          <>
            <div className="space-y-4 xl:hidden">
              {displayedGroups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  onEdit={() => setEditorState({ mode: "edit", group })}
                  onAction={(action) => setActionState({ action, group })}
                />
              ))}
            </div>
            <div className="hidden items-start gap-4 xl:grid xl:grid-cols-2">
              {[0, 1].map((columnIndex) => (
                <div key={columnIndex} className="space-y-4">
                  {displayedGroups
                    .filter((_group, groupIndex) => groupIndex % 2 === columnIndex)
                    .map((group) => (
                      <GroupCard
                        key={group.id}
                        group={group}
                        onEdit={() => setEditorState({ mode: "edit", group })}
                        onAction={(action) => setActionState({ action, group })}
                      />
                    ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <GroupsEmptyState tab={activeTab} onCreate={() => setEditorState({ mode: "create", group: null })} />
        )}
      </div>

      <UserGroupEditorModal
        state={editorState}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        memberIds={memberIds}
        getUserDetails={getUserDetails}
        onClose={() => setEditorState(null)}
        onSaved={async () => {
          setEditorState(null);
          await mutate();
        }}
      />
      <UserGroupActionModal
        state={actionState}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        onClose={() => setActionState(null)}
        onCompleted={async () => {
          setActionState(null);
          await mutate();
        }}
      />
    </SettingsContentWrapper>
  );
}

export default observer(UserGroupsPage);

function GroupsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[0, 1].map((item) => (
        <div key={item} className="animate-pulse rounded-lg border border-subtle p-4">
          <div className="h-5 w-40 rounded bg-layer-3" />
          <div className="mt-3 h-3 w-3/4 rounded bg-layer-2" />
          <div className="mt-6 space-y-2">
            <div className="h-10 rounded bg-layer-2" />
            <div className="h-10 rounded bg-layer-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupsEmptyState({ tab, onCreate }: { tab: TGroupsTab; onCreate: () => void }) {
  const { t } = useTranslation();
  const isArchived = tab === "archived";

  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-subtle bg-layer-1 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-accent-primary">
        {isArchived ? <Archive className="size-6" /> : <UsersRound className="size-6" />}
      </div>
      <h3 className="mt-4 text-16 font-semibold text-primary">
        {t(`project_settings.user_groups.empty.${tab}.title`)}
      </h3>
      <p className="mt-1 max-w-md text-13 text-secondary">
        {t(`project_settings.user_groups.empty.${tab}.description`)}
      </p>
      {!isArchived && (
        <Button className="mt-4" size="lg" onClick={onCreate}>
          <Plus className="size-4" />
          {t("project_settings.user_groups.create")}
        </Button>
      )}
    </div>
  );
}

function GroupCard({
  group,
  onEdit,
  onAction,
}: {
  group: TProjectUserGroup;
  onEdit: () => void;
  onAction: (action: TGroupAction) => void;
}) {
  const { t } = useTranslation();
  const isArchived = Boolean(group.archived_at);

  return (
    <article
      className={cn("overflow-hidden rounded-lg border border-subtle bg-layer-1", {
        "opacity-90": isArchived,
      })}
    >
      <div className="flex items-start justify-between gap-4 border-b border-subtle p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              isArchived ? "bg-layer-3 text-tertiary" : "bg-accent-subtle text-accent-primary"
            )}
          >
            <UsersRound className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-15 truncate font-semibold text-primary">{group.name}</h3>
              {isArchived && (
                <span className="rounded-full bg-layer-3 px-2 py-0.5 text-10 font-medium text-tertiary">
                  {t("project_settings.user_groups.archived")}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-12 text-secondary">
              {group.description || t("project_settings.user_groups.no_description")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isArchived ? (
            <>
              <Button variant="secondary" size="lg" onClick={() => onAction("restore")}>
                <RotateCcw className="size-4" />
                {t("project_settings.user_groups.restore")}
              </Button>
              <Button
                variant="error-outline"
                size="lg"
                title={t("project_settings.user_groups.delete")}
                aria-label={t("project_settings.user_groups.delete")}
                onClick={() => onAction("delete")}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" onClick={onEdit}>
                <Pencil className="size-4" />
                {t("project_settings.user_groups.edit")}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                title={t("project_settings.user_groups.archive")}
                aria-label={t("project_settings.user_groups.archive")}
                onClick={() => onAction("archive")}
              >
                <Archive className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-12 font-medium text-primary">
            <UserRound className="size-4 text-tertiary" />
            {t("project_settings.user_groups.members")}
          </div>
          <span className="rounded-full bg-layer-2 px-2 py-0.5 text-11 text-secondary">{group.members.length}</span>
        </div>

        {group.members.length > 0 ? (
          <div className="vertical-scrollbar scrollbar-sm max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {group.members.map((member) => (
              <GroupMemberRow key={member.id} member={member} />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-subtle px-3 py-6 text-center text-12 text-tertiary">
            {t("project_settings.user_groups.no_members")}
          </div>
        )}
      </div>
    </article>
  );
}

function GroupMemberRow({ member }: { member: TProjectUserGroupMember }) {
  const { t } = useTranslation();
  const isAvailable = member.project_member_active && member.account_status === "active";
  const statusLabel = !member.project_member_active
    ? t("project_settings.user_groups.not_in_project")
    : t(`project_settings.user_groups.status.${member.account_status}`);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-layer-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar
          src={getFileURL(member.avatar_url ?? "")}
          name={getUserFullName(member)}
          size="sm"
          className="shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate text-12 font-medium text-primary">{getUserFullName(member)}</p>
          {member.display_name && <p className="truncate text-11 text-tertiary">{member.email}</p>}
        </div>
      </div>
      {!isAvailable && (
        <span className="shrink-0 rounded-full bg-warning-subtle px-2 py-0.5 text-10 font-medium text-warning-primary">
          {statusLabel}
        </span>
      )}
    </div>
  );
}

function UserGroupEditorModal({
  state,
  workspaceSlug,
  projectId,
  memberIds,
  getUserDetails,
  onClose,
  onSaved,
}: {
  state: TEditorState | null;
  workspaceSlug: string;
  projectId: string;
  memberIds: string[];
  getUserDetails: (id: string) => any;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const group = state?.group ?? null;
  const isEdit = state?.mode === "edit";

  useEffect(() => {
    if (!state) return;
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setSelectedIds(group?.members.map((member) => member.member_id) ?? []);
    setSearchQuery("");
  }, [state, group]);

  const filteredMemberIds = memberIds.filter((memberId) => {
    const member = getUserDetails(memberId);
    const haystack = getUserSearchText(member);
    return haystack.includes(searchQuery.trim().toLocaleLowerCase());
  });
  const unavailableMembers = group?.members.filter((member) => !memberIds.includes(member.member_id)) ?? [];

  const toggleMember = (memberId: string) => {
    setSelectedIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]
    );
  };

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !state) return;
    setIsSubmitting(true);
    try {
      if (group) {
        await service.updateUserGroup(workspaceSlug, projectId, group.id, {
          name: trimmedName,
          description: description.trim(),
        });
        const currentIds = group.members.map((member) => member.member_id);
        const addMemberIds = selectedIds.filter((id) => !currentIds.includes(id));
        const removeMemberIds = currentIds.filter((id) => !selectedIds.includes(id));
        if (addMemberIds.length > 0 || removeMemberIds.length > 0) {
          await service.updateUserGroupMembers(workspaceSlug, projectId, group.id, {
            add_member_ids: addMemberIds,
            remove_member_ids: removeMemberIds,
          });
        }
      } else {
        await service.createUserGroup(workspaceSlug, projectId, {
          name: trimmedName,
          description: description.trim(),
          member_ids: selectedIds,
        });
      }
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t(
          isEdit
            ? "project_settings.user_groups.toast.updated.title"
            : "project_settings.user_groups.toast.created.title"
        ),
        message: t(
          isEdit
            ? "project_settings.user_groups.toast.updated.message"
            : "project_settings.user_groups.toast.created.message"
        ),
      });
      await onSaved();
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.user_groups.toast.error.title"),
        message: t("project_settings.user_groups.toast.error.message"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore
      isOpen={Boolean(state)}
      handleClose={handleClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.XXL}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-subtle px-5 py-4">
          <h2 className="text-18 font-semibold text-primary">
            {t(
              isEdit
                ? "project_settings.user_groups.editor.edit_title"
                : "project_settings.user_groups.editor.create_title"
            )}
          </h2>
          <p className="mt-1 text-12 text-secondary">{t("project_settings.user_groups.editor.description")}</p>
        </div>

        <div className="vertical-scrollbar scrollbar-md flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-12 font-medium text-primary">{t("project_settings.user_groups.name")}</span>
              <Input
                className="w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("project_settings.user_groups.name")}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-12 font-medium text-primary">
                {t("project_settings.user_groups.description_label")}
              </span>
              <Input
                className="w-full"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("project_settings.user_groups.description_placeholder")}
              />
            </label>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-13 font-semibold text-primary">{t("project_settings.user_groups.members")}</h3>
                <p className="mt-0.5 text-11 text-secondary">{t("project_settings.user_groups.editor.members_help")}</p>
              </div>
              <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-11 font-medium text-accent-primary">
                {selectedIds.length} {t("project_settings.user_groups.selected")}
              </span>
            </div>

            <Input
              className="w-full"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("project_settings.user_groups.search_members")}
            />

            <div className="vertical-scrollbar mt-2 scrollbar-md max-h-72 space-y-1 overflow-y-auto rounded-lg border border-subtle p-1.5">
              {filteredMemberIds.length > 0 ? (
                filteredMemberIds.map((memberId) => {
                  const member = getUserDetails(memberId);
                  const isSelected = selectedIds.includes(memberId);
                  return (
                    <button
                      key={memberId}
                      type="button"
                      onClick={() => toggleMember(memberId)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                        isSelected ? "bg-accent-subtle" : "hover:bg-layer-2"
                      )}
                    >
                      <Checkbox checked={isSelected} readOnly tabIndex={-1} />
                      <Avatar src={getFileURL(member?.avatar_url ?? "")} name={getUserFullName(member)} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-12 font-medium text-primary">{getUserFullName(member)}</p>
                        {member?.display_name && <p className="truncate text-11 text-tertiary">{member?.email}</p>}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-8 text-center text-12 text-tertiary">
                  {t("project_settings.user_groups.no_members_found")}
                </div>
              )}
            </div>
          </div>

          {unavailableMembers.length > 0 && (
            <div className="rounded-lg border border-warning-subtle bg-warning-subtle/30 p-3">
              <h3 className="text-12 font-semibold text-warning-primary">
                {t("project_settings.user_groups.unavailable_members")}
              </h3>
              <p className="mt-1 text-11 text-secondary">
                {t("project_settings.user_groups.unavailable_members_help")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unavailableMembers.map((member) => (
                  <span key={member.id} className="rounded-full bg-layer-2 px-2.5 py-1 text-11 text-secondary">
                    {getUserFullName(member)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-3">
          <Button variant="secondary" size="lg" onClick={handleClose} disabled={isSubmitting}>
            {t("cancel")}
          </Button>
          <Button size="lg" onClick={() => void handleSubmit()} disabled={!name.trim()} loading={isSubmitting}>
            {t(isEdit ? "project_settings.user_groups.save" : "project_settings.user_groups.create")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}

function UserGroupActionModal({
  state,
  workspaceSlug,
  projectId,
  onClose,
  onCompleted,
}: {
  state: TActionState | null;
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const action = state?.action ?? "archive";
  const group = state?.group ?? null;

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = async () => {
    if (!group) return;
    setIsSubmitting(true);
    try {
      if (action === "archive") await service.archiveUserGroup(workspaceSlug, projectId, group.id);
      if (action === "restore") await service.restoreUserGroup(workspaceSlug, projectId, group.id);
      if (action === "delete") await service.deleteUserGroup(workspaceSlug, projectId, group.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t(`project_settings.user_groups.confirm.${action}.success_title`),
        message: t(`project_settings.user_groups.confirm.${action}.success_message`),
      });
      await onCompleted();
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.user_groups.toast.error.title"),
        message: t("project_settings.user_groups.toast.error.message"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore
      isOpen={Boolean(state)}
      handleClose={handleClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.LG}
    >
      <div className="px-5 py-4">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            action === "delete" ? "bg-danger-subtle text-danger-primary" : "bg-accent-subtle text-accent-primary"
          )}
        >
          {action === "archive" && <Archive className="size-5" />}
          {action === "restore" && <RotateCcw className="size-5" />}
          {action === "delete" && <Trash2 className="size-5" />}
        </div>
        <h2 className="mt-4 text-18 font-semibold text-primary">
          {t(`project_settings.user_groups.confirm.${action}.title`)}
        </h2>
        <p className="mt-2 text-13 text-secondary">
          {group?.name && <span className="font-medium text-primary">{group.name}. </span>}
          {t(`project_settings.user_groups.confirm.${action}.description`)}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={handleClose} disabled={isSubmitting}>
            {t("cancel")}
          </Button>
          <Button
            variant={action === "delete" ? "error-fill" : "primary"}
            size="lg"
            onClick={() => void handleSubmit()}
            loading={isSubmitting}
          >
            {t(`project_settings.user_groups.confirm.${action}.action`)}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
