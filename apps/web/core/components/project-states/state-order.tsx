/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { observer } from "mobx-react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { EIconSize, STATE_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { StateGroupIcon } from "@plane/propel/icons";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { IState } from "@plane/types";
import { Button } from "@plane/ui";
import { cn } from "@plane/utils";
import { useProjectState } from "@/hooks/store/use-project-state";
import { ProjectStateLoader } from "./loader";

type TStateOrderSettings = {
  workspaceSlug: string;
  projectId: string;
};

type TStateOrderItem = {
  state: IState;
  index: number;
  total: number;
  onMove: (stateId: string, destinationIndex: number) => void;
  onDrop: (sourceId: string, destinationId: string, edge: "top" | "bottom") => void;
};

const StateOrderItem = observer(function StateOrderItem(props: TStateOrderItem) {
  const { state, index, total, onMove, onDrop } = props;
  const { t } = useTranslation();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragEdge, setDragEdge] = useState<"top" | "bottom" | null>(null);

  useEffect(() => {
    const element = itemRef.current;
    if (!element) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({ id: state.id, type: "PROJECT_STATE_ORDER" }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === "PROJECT_STATE_ORDER",
        getData: ({ input, element: targetElement }) =>
          attachClosestEdge(
            { id: state.id, type: "PROJECT_STATE_ORDER" },
            { input, element: targetElement, allowedEdges: ["top", "bottom"] }
          ),
        onDrag: ({ self }) => {
          const edge = extractClosestEdge(self.data);
          setDragEdge(edge === "top" || edge === "bottom" ? edge : null);
        },
        onDragLeave: () => setDragEdge(null),
        onDrop: ({ self, source }) => {
          const edge = extractClosestEdge(self.data);
          setDragEdge(null);
          if ((edge === "top" || edge === "bottom") && typeof source.data.id === "string")
            onDrop(source.data.id, state.id, edge);
        },
      })
    );
  }, [onDrop, state.id]);

  return (
    <div
      ref={itemRef}
      className={cn(
        "relative flex items-center gap-3 rounded-sm border border-subtle bg-surface-1 px-3 py-2.5",
        isDragging && "opacity-50",
        dragEdge === "top" && "border-t-accent-primary",
        dragEdge === "bottom" && "border-b-accent-primary"
      )}
    >
      <GripVertical className="size-4 flex-shrink-0 cursor-grab text-tertiary" />
      <div className="w-7 flex-shrink-0 text-center text-12 font-medium text-tertiary">{index + 1}</div>
      <StateGroupIcon stateGroup={state.group} color={state.color} size={EIconSize.LG} />
      <div className="min-w-0 flex-grow">
        <div className="truncate text-13 font-medium text-primary">{state.name}</div>
        <div className="text-11 text-secondary">
          {t(`project_settings.state_order.groups.${STATE_GROUPS[state.group].key}`)}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          className="grid size-7 place-items-center rounded-sm text-secondary hover:bg-layer-1 hover:text-primary disabled:cursor-not-allowed disabled:text-placeholder"
          onClick={() => onMove(state.id, index - 1)}
          disabled={index === 0}
          aria-label={`${state.name}: move up`}
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-sm text-secondary hover:bg-layer-1 hover:text-primary disabled:cursor-not-allowed disabled:text-placeholder"
          onClick={() => onMove(state.id, index + 1)}
          disabled={index === total - 1}
          aria-label={`${state.name}: move down`}
        >
          <ArrowDown className="size-4" />
        </button>
      </div>
    </div>
  );
});

export const StateOrderSettings = observer(function StateOrderSettings(props: TStateOrderSettings) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const { fetchProjectStates, getProjectStates, reorderStates } = useProjectState();
  const [orderedStateIds, setOrderedStateIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useSWR(
    workspaceSlug && projectId ? `PROJECT_STATE_ORDER_${workspaceSlug}_${projectId}` : null,
    () => fetchProjectStates(workspaceSlug, projectId),
    { revalidateOnFocus: false }
  );

  const projectStates = getProjectStates(projectId);
  const persistedStateIds = useMemo(() => projectStates?.map((state) => state.id) ?? [], [projectStates]);
  const persistedKey = persistedStateIds.join(":");
  const currentKey = orderedStateIds.join(":");
  const isDirty = currentKey !== persistedKey;

  useEffect(() => {
    setOrderedStateIds(persistedStateIds);
    // The joined key changes only when the persisted order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);

  const statesById = useMemo(() => new Map((projectStates ?? []).map((state) => [state.id, state])), [projectStates]);
  const orderedStates = orderedStateIds.map((stateId) => statesById.get(stateId)).filter((state) => !!state);

  const moveState = useCallback((stateId: string, destinationIndex: number) => {
    setOrderedStateIds((current) => {
      const sourceIndex = current.indexOf(stateId);
      if (sourceIndex === -1 || destinationIndex < 0 || destinationIndex >= current.length) return current;
      const next = [...current];
      const [movedId] = next.splice(sourceIndex, 1);
      next.splice(destinationIndex, 0, movedId);
      return next;
    });
  }, []);

  const dropState = useCallback((sourceId: string, destinationId: string, edge: "top" | "bottom") => {
    if (sourceId === destinationId) return;
    setOrderedStateIds((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const destinationIndex = current.indexOf(destinationId);
      if (sourceIndex === -1 || destinationIndex === -1) return current;

      const next = [...current];
      const [movedId] = next.splice(sourceIndex, 1);
      let insertionIndex = destinationIndex - (sourceIndex < destinationIndex ? 1 : 0);
      if (edge === "bottom") insertionIndex += 1;
      next.splice(insertionIndex, 0, movedId);
      return next;
    });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await reorderStates(workspaceSlug, projectId, orderedStateIds);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: t("project_settings.state_order.success"),
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("project_settings.state_order.error"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!projectStates) return <ProjectStateLoader />;

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-subtle bg-surface-2 px-4 py-3 text-12 text-secondary">
        {t("project_settings.state_order.help")}
      </div>
      <div className="space-y-2">
        {orderedStates.map((state, index) => (
          <StateOrderItem
            key={state.id}
            state={state}
            index={index}
            total={orderedStates.length}
            onMove={moveState}
            onDrop={dropState}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <Button
          variant="neutral-primary"
          onClick={() => setOrderedStateIds(persistedStateIds)}
          disabled={!isDirty || isSaving}
        >
          {t("project_settings.state_order.reset")}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!isDirty} loading={isSaving}>
          {t("project_settings.state_order.save")}
        </Button>
      </div>
    </div>
  );
});
