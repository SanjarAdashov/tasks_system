/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Dialog, Transition } from "@headlessui/react";
import { Fragment, useEffect, useState } from "react";
import { CalendarDays, UserRoundPen } from "lucide-react";
import { Button } from "@plane/propel/button";
import type { IInstanceUser, TInstanceUserProfilePayload } from "@plane/types";
import { Input } from "@plane/ui";
import {
  formatBirthDateForInput,
  getUserFullName,
  isBirthDateInputValid,
  maskBirthDateInput,
  parseBirthDateInput,
} from "@plane/utils";

type Props = {
  isOpen: boolean;
  user?: IInstanceUser;
  onClose: () => void;
  onSubmit: (payload: TInstanceUserProfilePayload) => Promise<void>;
};

export function UserProfileModal({ isOpen, user, onClose, onSubmit }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setFirstName(user.first_name || "");
    setLastName(user.last_name || "");
    setDateOfBirth(formatBirthDateForInput(user.date_of_birth));
    setIsSubmitting(false);
  }, [isOpen, user]);

  const isDateOfBirthValid = isBirthDateInputValid(dateOfBirth);

  const submit = async () => {
    if (!firstName.trim() || !isDateOfBirthValid) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: parseBirthDateInput(dateOfBirth) || null,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={isSubmitting ? () => undefined : onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100">
          <div className="fixed inset-0 bg-backdrop" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-3 scale-95 opacity-0"
              enterTo="translate-y-0 scale-100 opacity-100"
            >
              <Dialog.Panel className="w-full max-w-lg overflow-hidden rounded-xl border border-subtle bg-surface-1 shadow-raised-200">
                <div className="flex items-start gap-3 border-b border-subtle p-6">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-primary">
                    <UserRoundPen className="size-5" />
                  </div>
                  <div>
                    <Dialog.Title className="text-16 font-semibold text-primary">Edit user details</Dialog.Title>
                    <p className="mt-1 text-12 text-secondary">
                      Changes apply to {getUserFullName(user)} across every workspace.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-6 sm:grid-cols-2">
                  <label className="space-y-1.5 text-12 text-secondary">
                    <span>First name *</span>
                    <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={50} />
                  </label>
                  <label className="space-y-1.5 text-12 text-secondary">
                    <span>Last name</span>
                    <Input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={50} />
                  </label>
                  <label className="space-y-1.5 text-12 text-secondary sm:col-span-2">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" /> Date of birth
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={dateOfBirth}
                      onChange={(event) => setDateOfBirth(maskBirthDateInput(event.target.value))}
                      hasError={!isDateOfBirthValid}
                      placeholder="DD/MM/YYYY"
                      maxLength={10}
                    />
                    {!isDateOfBirthValid && (
                      <span className="block text-10 text-danger-primary">
                        Enter a valid past date in DD/MM/YYYY format.
                      </span>
                    )}
                    <span className="block text-10 text-tertiary">
                      DD/MM/YYYY. Optional; clear the field to remove it.
                    </span>
                  </label>
                </div>
                <div className="flex justify-end gap-2 border-t border-subtle px-6 py-4">
                  <Button variant="secondary" size="lg" disabled={isSubmitting} onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    loading={isSubmitting}
                    disabled={!firstName.trim() || !isDateOfBirthValid}
                    onClick={submit}
                  >
                    Save details
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
