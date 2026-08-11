/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const getProjectWorkItemPropertiesSWRKey = (workspaceSlug: string, projectId: string) =>
  `WORK_ITEM_PROPERTIES_${workspaceSlug}_${projectId}`;
