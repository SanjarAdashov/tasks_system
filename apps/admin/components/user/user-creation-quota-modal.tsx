import { Dialog, Transition } from "@headlessui/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { InstanceService } from "@plane/services";
import type { IInstanceUser } from "@plane/types";
import { Input, Loader } from "@plane/ui";

type Props = { user?: IInstanceUser; onClose: () => void };

const parseLimit = (value: string, unlimited: boolean) => (unlimited ? null : Math.max(0, Number(value) || 0));

export function UserCreationQuotaModal({ user, onClose }: Props) {
  const service = useMemo(() => new InstanceService(), []);
  const { data, isLoading, mutate } = useSWR(user ? ["USER_CREATION_QUOTAS", user.id] : null, () =>
    service.userCreationQuotas(user!.id)
  );
  const [workspaceLimit, setWorkspaceLimit] = useState("0");
  const [workspaceUnlimited, setWorkspaceUnlimited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setWorkspaceUnlimited(data.workspace.is_unlimited);
      setWorkspaceLimit(String(data.workspace.limit ?? 0));
    }
  }, [data]);

  const saveWorkspace = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await mutate(
        service.updateUserCreationQuotas(user.id, {
          workspace_limit: parseLimit(workspaceLimit, workspaceUnlimited),
        }),
        { revalidate: false }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Transition.Root show={Boolean(user)} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={saving ? () => undefined : onClose}>
        <div className="fixed inset-0 bg-backdrop" />
        <div className="fixed inset-0 overflow-y-auto p-4">
          <div className="flex min-h-full items-center justify-center">
            <Dialog.Panel className="w-full max-w-2xl rounded-lg bg-surface-1 shadow-raised-200">
              <div className="border-b border-subtle p-6">
                <Dialog.Title className="text-16 font-medium text-primary">Creation quotas</Dialog.Title>
                <p className="mt-1 text-13 text-secondary">{user?.display_name || user?.email}</p>
              </div>
              <div className="max-h-[65vh] space-y-5 overflow-y-auto p-6">
                {isLoading || !data ? (
                  <Loader>
                    <Loader.Item height="120px" width="100%" />
                  </Loader>
                ) : data.is_instance_admin ? (
                  <div className="rounded-md bg-accent-subtle p-4 text-13 text-accent-primary">
                    Instance administrators have unlimited creation access.
                  </div>
                ) : (
                  <>
                    <QuotaEditor
                      title="Workspaces"
                      used={data.workspace.used}
                      limit={workspaceLimit}
                      unlimited={workspaceUnlimited}
                      onLimitChange={setWorkspaceLimit}
                      onUnlimitedChange={setWorkspaceUnlimited}
                      onSave={saveWorkspace}
                      saving={saving}
                    />
                    <div className="space-y-3">
                      <div className="text-13 font-medium text-primary">Projects by workspace</div>
                      {data.projects.map((quota) => (
                        <ProjectQuotaEditor
                          key={quota.workspace_id}
                          quota={quota}
                          onSave={async (limit: number | null) => {
                            setSaving(true);
                            try {
                              await mutate(
                                service.updateUserCreationQuotas(user!.id, {
                                  project_quota: { workspace_id: quota.workspace_id, limit },
                                }),
                                { revalidate: false }
                              );
                            } finally {
                              setSaving(false);
                            }
                          }}
                          saving={saving}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end border-t border-subtle px-6 py-4">
                <Button variant="secondary" size="lg" onClick={onClose}>
                  Close
                </Button>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

function QuotaEditor({ title, used, limit, unlimited, onLimitChange, onUnlimitedChange, onSave, saving }: any) {
  return (
    <div className="rounded-md border border-subtle p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-13 font-medium">{title}</span>
        <span className="text-11 text-tertiary">Used: {used}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="number"
          min={0}
          value={limit}
          disabled={unlimited}
          onChange={(e) => onLimitChange(e.target.value)}
          className="w-28"
        />
        <label className="flex items-center gap-2 text-12">
          <input type="checkbox" checked={unlimited} onChange={(e) => onUnlimitedChange(e.target.checked)} />
          Unlimited
        </label>
        <Button size="sm" onClick={() => void onSave()} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ProjectQuotaEditor({ quota, onSave, saving }: any) {
  const [value, setValue] = useState(String(quota.limit ?? 0));
  const [unlimited, setUnlimited] = useState(quota.is_unlimited);
  useEffect(() => {
    setValue(String(quota.limit ?? 0));
    setUnlimited(quota.is_unlimited);
  }, [quota]);
  return (
    <QuotaEditor
      title={quota.workspace_name}
      used={quota.used}
      limit={value}
      unlimited={unlimited}
      onLimitChange={setValue}
      onUnlimitedChange={setUnlimited}
      onSave={() => onSave(parseLimit(value, unlimited))}
      saving={saving}
    />
  );
}
