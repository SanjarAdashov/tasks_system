import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { InstanceService } from "@plane/services";
import { Input } from "@plane/ui";
import type { IUserLite, TProjectUserGroup } from "@plane/types";
import { getUserFullName } from "@plane/utils";
import { PageWrapper } from "@/components/common/page-wrapper";
import type { Route } from "./+types/page";

const UserGroupsPage = (_props: Route.ComponentProps) => {
  const service = useMemo(() => new InstanceService(), []);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { data: base } = useSWR("INSTANCE_USER_GROUP_CONTEXT", () => service.projectUserGroupContext());
  const { data, mutate } = useSWR(projectId ? ["INSTANCE_PROJECT_GROUPS", projectId] : null, () =>
    service.projectUserGroupContext(projectId, true)
  );
  const workspace = base?.workspaces.find((item) => item.slug === workspaceSlug);

  const create = async () => {
    await service.createProjectUserGroup(workspaceSlug, projectId, { name, description, member_ids: selected });
    setName("");
    setDescription("");
    setSelected([]);
    await mutate();
  };

  return (
    <PageWrapper
      header={{
        title: "Project user groups",
        description: "Instance Admin access across all workspaces and projects.",
      }}
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="h-9 rounded border border-subtle bg-surface-1 px-3"
            value={workspaceSlug}
            onChange={(e) => {
              setWorkspaceSlug(e.target.value);
              setProjectId("");
            }}
          >
            <option value="">Select workspace</option>
            {base?.workspaces.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded border border-subtle bg-surface-1 px-3"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!workspace}
          >
            <option value="">Select project</option>
            {workspace?.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {projectId && (
          <>
            <div className="rounded-md border border-subtle p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data?.eligible_members.map((member) => (
                  <label key={member.id} className="rounded bg-layer-2 px-2 py-1 text-12">
                    <input
                      className="mr-2"
                      type="checkbox"
                      checked={selected.includes(member.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id)
                        )
                      }
                    />
                    {getUserFullName(member)}
                  </label>
                ))}
              </div>
              <Button className="mt-3" disabled={!name.trim()} onClick={() => void create()}>
                Create group
              </Button>
            </div>
            <div className="space-y-3">
              {data?.groups.map((group) => (
                <AdminGroupCard
                  key={group.id}
                  group={group}
                  eligible={data.eligible_members}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  service={service}
                  refresh={mutate}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </PageWrapper>
  );
};

export default UserGroupsPage;

function AdminGroupCard({
  group,
  eligible,
  workspaceSlug,
  projectId,
  service,
  refresh,
}: {
  group: TProjectUserGroup;
  eligible: IUserLite[];
  workspaceSlug: string;
  projectId: string;
  service: InstanceService;
  refresh: () => Promise<any>;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [selected, setSelected] = useState(group.members.map((member) => member.member_id));
  useEffect(() => {
    setName(group.name);
    setDescription(group.description);
    setSelected(group.members.map((member) => member.member_id));
  }, [group]);
  const save = async () => {
    await service.updateProjectUserGroup(workspaceSlug, projectId, group.id, { name, description });
    const current = group.members.map((member) => member.member_id);
    await service.updateProjectUserGroupMembers(workspaceSlug, projectId, group.id, {
      add_member_ids: selected.filter((id) => !current.includes(id)),
      remove_member_ids: current.filter((id) => !selected.includes(id)),
    });
    await refresh();
  };
  return (
    <div className="rounded-md border border-subtle p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(group.archived_at)} />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={Boolean(group.archived_at)}
        />
      </div>
      {!group.archived_at && (
        <div className="mt-3 flex flex-wrap gap-2">
          {eligible.map((member) => (
            <label key={member.id} className="rounded bg-layer-2 px-2 py-1 text-11">
              <input
                className="mr-2"
                type="checkbox"
                checked={selected.includes(member.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))
                }
              />
              {getUserFullName(member)}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {group.archived_at ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await service.restoreProjectUserGroup(workspaceSlug, projectId, group.id);
                await refresh();
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="error-outline"
              onClick={async () => {
                if (window.confirm("Delete this group permanently?")) {
                  await service.deleteProjectUserGroup(workspaceSlug, projectId, group.id);
                  await refresh();
                }
              }}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => void save()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await service.archiveProjectUserGroup(workspaceSlug, projectId, group.id);
                await refresh();
              }}
            >
              Archive
            </Button>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {group.members
          .filter((member) => !member.project_member_active || member.account_status !== "active")
          .map((member) => (
            <span key={member.id} className="rounded bg-warning-subtle px-2 py-1 text-11">
              {getUserFullName(member)}
              {!member.project_member_active ? " · not in project" : ` · ${member.account_status}`}
            </span>
          ))}
      </div>
    </div>
  );
}
