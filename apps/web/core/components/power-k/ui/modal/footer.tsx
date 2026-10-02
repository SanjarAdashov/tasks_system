/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ToggleSwitch } from "@plane/ui";

type Props = {
  isWorkspaceLevel: boolean;
  projectId: string | undefined;
  onWorkspaceLevelChange: (value: boolean) => void;
  searchDescription: boolean;
  onSearchDescriptionChange: (value: boolean) => void;
};

export const PowerKModalFooter = observer(function PowerKModalFooter(props: Props) {
  const { isWorkspaceLevel, projectId, onWorkspaceLevelChange, searchDescription, onSearchDescriptionChange } = props;
  // translation
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-b-lg border-t border-subtle bg-surface-2/80 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-11 text-tertiary">{t("power_k.footer.workspace_level")}</span>
        <ToggleSwitch
          value={isWorkspaceLevel}
          onChange={() => onWorkspaceLevelChange(!isWorkspaceLevel)}
          disabled={!projectId}
          label={t("power_k.footer.workspace_level")}
          size="sm"
        />
      </div>
      <div className="flex items-center gap-2" title={t("power_k.footer.search_in_tasks_description")}>
        <span className="text-11 text-tertiary">{t("power_k.footer.search_in_tasks")}</span>
        <ToggleSwitch
          value={searchDescription}
          onChange={onSearchDescriptionChange}
          label={t("power_k.footer.search_in_tasks")}
          size="sm"
        />
      </div>
    </div>
  );
});
