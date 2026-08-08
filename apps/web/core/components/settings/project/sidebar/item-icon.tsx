/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";
import { GitBranch, ListChecks, ListOrdered, Paperclip, UserRoundCog, Users, Zap } from "lucide-react";
// plane imports
import type { ISvgIcons } from "@plane/propel/icons";
import {
  CycleIcon,
  EstimatePropertyIcon,
  IntakeIcon,
  LabelPropertyIcon,
  ModuleIcon,
  PageIcon,
  StatePropertyIcon,
  ViewsIcon,
} from "@plane/propel/icons";
import type { TProjectSettingsTabs } from "@plane/types";
// components
import { SettingIcon } from "@/components/icons/attachment";

export const PROJECT_SETTINGS_ICONS: Record<TProjectSettingsTabs, LucideIcon | React.FC<ISvgIcons>> = {
  general: SettingIcon,
  members: Users,
  user_groups: UserRoundCog,
  features_cycles: CycleIcon,
  features_modules: ModuleIcon,
  features_views: ViewsIcon,
  features_pages: PageIcon,
  features_intake: IntakeIcon,
  states: StatePropertyIcon,
  state_order: ListOrdered,
  state_transitions: GitBranch,
  attachments: Paperclip,
  labels: LabelPropertyIcon,
  estimates: EstimatePropertyIcon,
  work_item_fields: ListChecks,
  automations: Zap,
};
