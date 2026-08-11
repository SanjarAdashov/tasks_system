/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { ShieldCheck, UserX } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import type { IInstanceUser } from "@plane/types";
import { cn, getUserFullName } from "@plane/utils";

export type TUserAccessAction = "block" | "unblock";

type Props = {
  action: TUserAccessAction;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  user: IInstanceUser | undefined;
};

export function UserAccessModal(props: Props) {
  const { action, isOpen, onClose, onSubmit, user } = props;
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBlocking = action === "block";
  const userName = getUserFullName(user);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setIsSubmitting(false);
    }
  }, [action, isOpen, user?.id]);

  const handleSubmit = async () => {
    if (!user || (isBlocking && !reason.trim())) return;
    setIsSubmitting(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={isSubmitting ? () => undefined : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-backdrop transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-3 scale-95"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-3 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-lg bg-surface-1 text-left shadow-raised-200 transition-all">
                <div className="space-y-5 p-6">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        isBlocking ? "bg-danger-subtle text-danger-primary" : "bg-success-subtle text-success-primary"
                      )}
                    >
                      {isBlocking ? <UserX className="size-5" /> : <ShieldCheck className="size-5" />}
                    </div>
                    <div className="space-y-1">
                      <Dialog.Title className="text-16 font-medium text-primary">
                        {isBlocking ? "Block user" : "Unblock user"}
                      </Dialog.Title>
                      <p className="text-13 leading-5 text-secondary">
                        {isBlocking
                          ? `${userName} will be signed out and will no longer be able to sign in. Their roles, tasks, and history will be preserved.`
                          : `${userName} will be able to sign in again with their existing account and roles.`}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="user-access-reason" className="text-13 font-medium text-secondary">
                      Reason {isBlocking ? "" : "(optional)"}
                    </label>
                    <textarea
                      id="user-access-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={isBlocking ? "Explain why access is being blocked" : "Add a note for the audit log"}
                      rows={4}
                      maxLength={2000}
                      disabled={isSubmitting}
                      className="w-full resize-none rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-strong disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="flex justify-between text-11 text-tertiary">
                      <span>
                        {isBlocking ? "Required. Saved in the access audit log." : "Saved in the access audit log."}
                      </span>
                      <span>{reason.length}/2000</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-subtle px-6 py-4">
                  <Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button
                    variant={isBlocking ? "error-fill" : "primary"}
                    size="lg"
                    onClick={() => void handleSubmit()}
                    loading={isSubmitting}
                    disabled={isBlocking && !reason.trim()}
                  >
                    {isBlocking ? "Block user" : "Unblock user"}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
