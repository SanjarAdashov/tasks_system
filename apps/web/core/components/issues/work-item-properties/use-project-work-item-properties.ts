/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import useSWR from "swr";
import { ProjectService } from "@/services/project";
import { getProjectWorkItemPropertiesSWRKey } from "./swr-key";

const projectService = new ProjectService();

export const useProjectWorkItemProperties = () => {
  const { workspaceSlug: routerWorkspaceSlug, projectId: routerProjectId } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  const projectId = routerProjectId?.toString();
  const { data } = useSWR(
    workspaceSlug && projectId ? getProjectWorkItemPropertiesSWRKey(workspaceSlug, projectId) : null,
    () => projectService.getWorkItemProperties(workspaceSlug as string, projectId as string)
  );
  return data ?? [];
};
