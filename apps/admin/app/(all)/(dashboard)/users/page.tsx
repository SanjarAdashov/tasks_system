/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Gauge, Search, ShieldCheck, UserRound, UserX } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type { IInstanceUser, TInstanceUserStatus } from "@plane/types";
import { Input, Loader } from "@plane/ui";
import { cn, getUserFullName } from "@plane/utils";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
import { UserAccessModal, type TUserAccessAction } from "@/components/user/user-access-modal";
import { UserCreationQuotaModal } from "@/components/user/user-creation-quota-modal";
// hooks
import { useUser } from "@/hooks/store";
// types
import type { Route } from "./+types/page";

const STATUS_STYLES: Record<TInstanceUserStatus, string> = {
  active: "bg-success-subtle text-success-primary",
  blocked: "bg-danger-subtle text-danger-primary",
  inactive: "bg-layer-3 text-tertiary",
};

function getUserName(user: IInstanceUser) {
  return getUserFullName(user);
}

function getInitials(user: IInstanceUser) {
  const name = getUserName(user);
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const UserManagementPage = function UserManagementPage(_props: Route.ComponentProps) {
  const instanceService = useMemo(() => new InstanceService(), []);
  const { currentUser } = useUser();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [selectedUser, setSelectedUser] = useState<IInstanceUser>();
  const [selectedAction, setSelectedAction] = useState<TUserAccessAction>("block");
  const [quotaUser, setQuotaUser] = useState<IInstanceUser>();

  const { data, error, isLoading, mutate } = useSWR(["INSTANCE_USERS", search, cursor], () =>
    instanceService.users(search, cursor)
  );

  const openAccessModal = (user: IInstanceUser, action: TUserAccessAction) => {
    setSelectedUser(user);
    setSelectedAction(action);
  };

  const closeAccessModal = () => setSelectedUser(undefined);

  const handleAccessChange = async (reason: string) => {
    if (!selectedUser) return;

    try {
      const updatedUser =
        selectedAction === "block"
          ? await instanceService.blockUser(selectedUser.id, { reason })
          : await instanceService.unblockUser(selectedUser.id, { reason });

      await mutate();

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: selectedAction === "block" ? "User blocked" : "User unblocked",
        message:
          selectedAction === "block"
            ? `${getUserName(updatedUser)} can no longer sign in.`
            : `${getUserName(updatedUser)} can sign in again.`,
      });
      closeAccessModal();
    } catch (accessError: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: selectedAction === "block" ? "Could not block user" : "Could not unblock user",
        message: accessError?.error?.message || "Please try again.",
      });
      throw accessError;
    }
  };

  return (
    <PageWrapper
      header={{
        title: "Users on this instance",
        description: "Block or restore access without changing workspace roles or deleting user data.",
      }}
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-16 font-medium text-primary">
              All users {data && <span className="text-tertiary">• {data.total_results}</span>}
            </div>
            <p className="mt-1 text-11 leading-5 text-tertiary">
              Blocking ends active sessions and disables existing personal API tokens.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-tertiary" />
            <Input
              id="instance-user-search"
              name="instance-user-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCursor("");
              }}
              placeholder="Search users"
              className="w-full pl-8"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-subtle bg-layer-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-11 font-medium text-tertiary">Total users</div>
                <div className="mt-1 text-24 font-semibold text-primary">
                  {data ? data.extra_stats.total_users : "—"}
                </div>
              </div>
              <div className="rounded-md bg-accent-subtle p-2 text-accent-primary">
                <UserRound className="size-5" />
              </div>
            </div>
          </div>
          <div className="rounded-md border border-subtle bg-layer-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-11 font-medium text-tertiary">Active users</div>
                <div className="mt-1 text-24 font-semibold text-primary">
                  {data ? data.extra_stats.active_users : "—"}
                </div>
              </div>
              <div className="rounded-md bg-success-subtle p-2 text-success-primary">
                <ShieldCheck className="size-5" />
              </div>
            </div>
          </div>
          <div className="rounded-md border border-subtle bg-layer-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-11 font-medium text-tertiary">Blocked users</div>
                <div className="mt-1 text-24 font-semibold text-primary">
                  {data ? data.extra_stats.blocked_users : "—"}
                </div>
              </div>
              <div className="rounded-md bg-danger-subtle p-2 text-danger-primary">
                <UserX className="size-5" />
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Loader className="space-y-3">
            <Loader.Item height="64px" width="100%" />
            <Loader.Item height="64px" width="100%" />
            <Loader.Item height="64px" width="100%" />
          </Loader>
        ) : error ? (
          <div className="rounded-md border border-danger-subtle bg-danger-subtle p-4 text-13 text-danger-primary">
            Users could not be loaded. Refresh the page to try again.
          </div>
        ) : data?.results.length ? (
          <div className="overflow-hidden rounded-md border border-subtle">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(8rem,0.8fr)_auto] gap-4 border-b border-subtle bg-layer-1 px-4 py-2 text-11 font-medium text-tertiary sm:grid">
              <div>User</div>
              <div>Status</div>
              <div className="w-28 text-right">Access</div>
            </div>
            <div className="divide-y divide-subtle">
              {data.results.map((user) => {
                const isCurrentUser = user.id === currentUser?.id;
                return (
                  <div
                    key={user.id}
                    className={cn(
                      "grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(8rem,0.8fr)_auto] sm:items-center sm:gap-4",
                      user.status === "blocked" && "bg-danger-subtle/20"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-layer-3 text-11 font-medium text-secondary">
                          {getInitials(user)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-13 font-medium text-primary">{getUserName(user)}</span>
                          {user.is_instance_admin && (
                            <span className="rounded-sm bg-accent-subtle px-1.5 py-0.5 text-11 text-accent-primary">
                              Instance admin
                            </span>
                          )}
                          {isCurrentUser && <span className="text-11 text-tertiary">You</span>}
                        </div>
                        <div className="truncate text-11 text-tertiary">{user.email}</div>
                        {user.status === "blocked" && user.blocked_reason && (
                          <div className="mt-1 line-clamp-1 text-11 text-danger-secondary">
                            Reason: {user.blocked_reason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {user.status === "blocked" ? (
                        <UserX className="size-4 text-danger-primary" />
                      ) : user.status === "active" ? (
                        <ShieldCheck className="size-4 text-success-primary" />
                      ) : (
                        <UserRound className="size-4 text-tertiary" />
                      )}
                      <span
                        className={cn(
                          "inline-flex rounded-sm px-2 py-0.5 text-11 font-medium capitalize",
                          STATUS_STYLES[user.status]
                        )}
                      >
                        {user.status}
                      </span>
                    </div>

                    <div className="flex w-full justify-end gap-2 sm:w-auto">
                      <Button variant="secondary" size="lg" onClick={() => setQuotaUser(user)}>
                        <Gauge className="mr-1 size-4" /> Quotas
                      </Button>
                      {user.status === "active" ? (
                        <Button
                          variant="error-outline"
                          size="lg"
                          onClick={() => openAccessModal(user, "block")}
                          disabled={isCurrentUser}
                        >
                          Block
                        </Button>
                      ) : user.status === "blocked" ? (
                        <Button variant="secondary" size="lg" onClick={() => openAccessModal(user, "unblock")}>
                          Unblock
                        </Button>
                      ) : (
                        <span className="text-11 text-tertiary">Not activated</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {data.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-subtle bg-layer-1 px-4 py-3">
                <span className="text-11 text-tertiary">
                  Showing {data.results.length} of {data.total_results} users
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setCursor(data.prev_cursor)}
                    disabled={!data.prev_page_results}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setCursor(data.next_cursor)}
                    disabled={!data.next_page_results}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-subtle p-8 text-center">
            <UserRound className="mx-auto size-6 text-tertiary" />
            <div className="mt-2 text-13 font-medium text-primary">No users found</div>
            <div className="mt-1 text-11 text-tertiary">Try a different name or email address.</div>
          </div>
        )}
      </div>

      <UserAccessModal
        action={selectedAction}
        isOpen={Boolean(selectedUser)}
        onClose={closeAccessModal}
        onSubmit={handleAccessChange}
        user={selectedUser}
      />
      <UserCreationQuotaModal user={quotaUser} onClose={() => setQuotaUser(undefined)} />
    </PageWrapper>
  );
};

export const meta: Route.MetaFunction = () => [{ title: "User Management - God Mode" }];

export default UserManagementPage;
