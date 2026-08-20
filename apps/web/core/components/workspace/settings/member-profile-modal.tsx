/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { CalendarDays, UserRoundPen } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IUserLite } from "@plane/types";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { formatBirthDateForInput, isBirthDateInputValid, maskBirthDateInput, parseBirthDateInput } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";

type Props = {
  isOpen: boolean;
  member: IUserLite | null;
  workspaceSlug: string;
  onClose: () => void;
};

export function WorkspaceMemberProfileModal({ isOpen, member, workspaceSlug, onClose }: Props) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const {
    workspace: { updateMember },
  } = useMember();

  useEffect(() => {
    if (!isOpen || !member) return;
    setFirstName(member.first_name || "");
    setLastName(member.last_name || "");
    setDateOfBirth(formatBirthDateForInput(member.date_of_birth));
  }, [isOpen, member]);

  const isDateOfBirthValid = isBirthDateInputValid(dateOfBirth);

  const save = async () => {
    if (!member || !firstName.trim() || !isDateOfBirthValid) return;
    setIsSaving(true);
    try {
      await updateMember(workspaceSlug, member.id, {
        user_profile: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: parseBirthDateInput(dateOfBirth) || null,
        },
      });
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("toast.success"), message: t("profile_updated_successfully") });
      onClose();
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message:
          error?.first_name?.[0] ||
          error?.date_of_birth?.[0] ||
          error?.error ||
          t("something_went_wrong_please_try_again"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={onClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.LG}
      className="border border-subtle bg-surface-1 shadow-raised-200"
    >
      <div className="flex items-start gap-3 border-b border-subtle p-5">
        <div className="grid size-10 place-items-center rounded-full bg-accent-subtle text-accent-primary">
          <UserRoundPen className="size-5" />
        </div>
        <div>
          <h2 className="text-16 font-semibold text-primary">
            {t("workspace_settings.settings.members.edit_profile")}
          </h2>
          <p className="mt-1 text-11 text-secondary">{t("workspace_settings.settings.members.edit_profile_hint")}</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="space-y-1.5 text-12 text-secondary">
          <span>{t("first_name")} *</span>
          <Input value={firstName} maxLength={50} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label className="space-y-1.5 text-12 text-secondary">
          <span>{t("last_name")}</span>
          <Input value={lastName} maxLength={50} onChange={(event) => setLastName(event.target.value)} />
        </label>
        <label className="space-y-1.5 text-12 text-secondary sm:col-span-2">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5" /> {t("calendar.date_of_birth")}
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
            <span className="block text-10 text-danger-primary">{t("calendar.invalid_date_of_birth")}</span>
          )}
          <span className="block text-10 text-tertiary">{t("calendar.date_of_birth_hint")}</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-subtle px-5 py-4">
        <Button variant="secondary" disabled={isSaving} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="primary" loading={isSaving} disabled={!firstName.trim() || !isDateOfBirthValid} onClick={save}>
          {t("save_changes")}
        </Button>
      </div>
    </ModalCore>
  );
}
