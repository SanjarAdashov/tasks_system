/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Image, BrainCog, CalendarSync, Cog, Mail, Send, UserRoundCog, Users } from "lucide-react";
// plane imports
import { LockIcon, WorkspaceIcon } from "@plane/propel/icons";
// types
import type { TSidebarMenuItem } from "./types";

export type TCoreSidebarMenuKey =
  | "general"
  | "email"
  | "telegram"
  | "calendar"
  | "workspace"
  | "users"
  | "user-groups"
  | "authentication"
  | "ai"
  | "image";

export const coreSidebarMenuLinks: Record<TCoreSidebarMenuKey, TSidebarMenuItem> = {
  general: {
    Icon: Cog,
    name: "General",
    description: "Identify your instances and get key details.",
    href: `/general/`,
  },
  email: {
    Icon: Mail,
    name: "Email",
    description: "Configure your SMTP controls.",
    href: `/email/`,
  },
  telegram: {
    Icon: Send,
    name: "Telegram",
    description: "Configure personal bot notifications.",
    href: `/telegram/`,
  },
  calendar: {
    Icon: CalendarSync,
    name: "Calendar and meetings",
    description: "Configure calendar OAuth and Google Meet.",
    href: `/calendar/`,
  },
  workspace: {
    Icon: WorkspaceIcon,
    name: "Workspaces",
    description: "Manage all workspaces on this instance.",
    href: `/workspace/`,
  },
  users: {
    Icon: Users,
    name: "Users",
    description: "Manage sign-in access for users.",
    href: `/users/`,
  },
  "user-groups": {
    Icon: UserRoundCog,
    name: "User groups",
    description: "Manage project-scoped user groups.",
    href: `/user-groups/`,
  },
  authentication: {
    Icon: LockIcon,
    name: "Authentication",
    description: "Configure authentication modes.",
    href: `/authentication/`,
  },
  ai: {
    Icon: BrainCog,
    name: "Artificial intelligence",
    description: "Configure your OpenAI creds.",
    href: `/ai/`,
  },
  image: {
    Icon: Image,
    name: "Images in Plane",
    description: "Allow third-party image libraries.",
    href: `/image/`,
  },
};
