/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Ban } from "lucide-react";
import { EUserProjectRoles } from "@plane/types";
// plane ui
import { Avatar, CustomSearchSelect } from "@plane/ui";
// helpers
import {
  getDuplicateUserNames,
  getFileURL,
  getUserFullName,
  getUserNameWithEmail,
  getUserSearchText,
} from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";

type Props = {
  value: any;
  onChange: (val: string) => void;
  isDisabled?: boolean;
};

export const MemberSelect = observer(function MemberSelect(props: Props) {
  const { value, onChange, isDisabled = false } = props;
  // router
  const { projectId } = useParams();
  // store hooks
  const {
    project: { projectMemberIds, getProjectMemberDetails },
  } = useMember();
  const projectMembers =
    projectMemberIds?.map((userId) =>
      projectId ? getProjectMemberDetails(userId, projectId.toString())?.member : undefined
    ) ?? [];
  const duplicateNames = getDuplicateUserNames(projectMembers);

  const options = projectMemberIds
    ?.map((userId) => {
      const memberDetails = projectId ? getProjectMemberDetails(userId, projectId.toString()) : null;

      if (!memberDetails?.member) return;
      const isGuest = memberDetails.role === EUserProjectRoles.GUEST;
      if (isGuest) return;
      const memberName = getUserNameWithEmail(memberDetails.member, duplicateNames);

      return {
        value: `${memberDetails?.member.id}`,
        query: getUserSearchText(memberDetails.member),
        content: (
          <div className="flex items-center gap-2">
            <Avatar name={memberName} src={getFileURL(memberDetails?.member.avatar_url)} />
            {memberName}
          </div>
        ),
      };
    })
    .filter((option) => !!option) as
    | {
        value: string;
        query: string;
        content: React.ReactNode;
      }[]
    | undefined;
  const selectedOption = projectId ? getProjectMemberDetails(value, projectId.toString()) : null;
  const selectedName = getUserNameWithEmail(selectedOption?.member, duplicateNames);

  return (
    <CustomSearchSelect
      value={value}
      label={
        <div className="flex h-3.5 items-center gap-2">
          {selectedOption && (
            <Avatar name={getUserFullName(selectedOption.member)} src={getFileURL(selectedOption.member?.avatar_url)} />
          )}
          {selectedOption ? (
            selectedName
          ) : (
            <div className="flex items-center gap-2">
              <Ban className="h-3.5 w-3.5 rotate-90 text-placeholder" />
              <span className="text-13 text-placeholder">None</span>
            </div>
          )}
        </div>
      }
      buttonClassName="!px-3 !py-2 bg-surface-1"
      options={
        options &&
        options && [
          ...options,
          {
            value: "none",
            query: "none",
            content: (
              <div className="flex items-center gap-2">
                <Ban className="h-3.5 w-3.5 rotate-90 text-placeholder" />
                <span className="py-0.5 text-13 text-placeholder">None</span>
              </div>
            ),
          },
        ]
      }
      maxHeight="md"
      onChange={onChange}
      disabled={isDisabled}
    />
  );
});
