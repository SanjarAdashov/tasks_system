/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { AtSign, Briefcase, ListChecks } from "lucide-react";
import useSWR from "swr";
// plane imports
import { Logo } from "@plane/propel/emoji-icon-picker";
import {
  CalendarLayoutIcon,
  CycleGroupIcon,
  CycleIcon,
  ModuleIcon,
  StatePropertyIcon,
  PriorityIcon,
  StateGroupIcon,
  MembersPropertyIcon,
  LabelPropertyIcon,
  StartDatePropertyIcon,
  DueDatePropertyIcon,
  UserCirclePropertyIcon,
  PriorityPropertyIcon,
} from "@plane/propel/icons";
import type {
  ICycle,
  IState,
  IUserLite,
  TFilterConfig,
  IIssueLabel,
  IModule,
  IProject,
  TWorkItemFilterProperty,
  TProjectWorkItemProperty,
} from "@plane/types";
import { COLLECTION_OPERATOR, EQUALITY_OPERATOR, FILTER_FIELD_TYPE } from "@plane/types";
import { Avatar } from "@plane/ui";
import {
  getAssigneeFilterConfig,
  getCreatedAtFilterConfig,
  getCreatedByFilterConfig,
  getCycleFilterConfig,
  getFileURL,
  getLabelFilterConfig,
  getMentionFilterConfig,
  getModuleFilterConfig,
  getPriorityFilterConfig,
  getProjectFilterConfig,
  getStartDateFilterConfig,
  getStateFilterConfig,
  getStateGroupFilterConfig,
  getSubscriberFilterConfig,
  getTargetDateFilterConfig,
  getUpdatedAtFilterConfig,
  createFilterConfig,
  createFilterFieldConfig,
  getDatePropertyFilterConfig,
  getMultiSelectConfig,
  getSingleSelectConfig,
  isLoaderReady,
} from "@plane/utils";
// store hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useProjectWorkItemFieldVisibility } from "@/hooks/use-project-work-item-field-visibility";
// plane web imports
import { useFiltersOperatorConfigs } from "@/hooks/rich-filters/use-filters-operator-configs";
import { ProjectService } from "@/services/project";

const projectService = new ProjectService();

export type TWorkItemFiltersEntityProps = {
  workspaceSlug: string;
  cycleIds?: string[];
  labelIds?: string[];
  memberIds?: string[];
  moduleIds?: string[];
  projectId?: string;
  projectIds?: string[];
  stateIds?: string[];
};

export type TUseWorkItemFiltersConfigProps = {
  allowedFilters: TWorkItemFilterProperty[];
} & TWorkItemFiltersEntityProps;

export type TWorkItemFiltersConfig = {
  areAllConfigsInitialized: boolean;
  configs: TFilterConfig<TWorkItemFilterProperty>[];
  configMap: {
    [key in TWorkItemFilterProperty]?: TFilterConfig<TWorkItemFilterProperty>;
  };
  isFilterEnabled: (key: TWorkItemFilterProperty) => boolean;
  members: IUserLite[];
};

export const useWorkItemFiltersConfig = (props: TUseWorkItemFiltersConfigProps): TWorkItemFiltersConfig => {
  const { allowedFilters, cycleIds, labelIds, memberIds, moduleIds, projectId, projectIds, stateIds, workspaceSlug } =
    props;
  // store hooks
  const { loader: projectLoader, getProjectById } = useProject();
  const { getCycleById } = useCycle();
  const { getLabelById } = useLabel();
  const { getModuleById } = useModule();
  const { getStateById } = useProjectState();
  const { getUserDetails } = useMember();
  // derived values
  const operatorConfigs = useFiltersOperatorConfigs({ workspaceSlug });
  const { data: customProperties } = useSWR(
    projectId ? `ISSUE_CUSTOM_PROPERTIES_${workspaceSlug}_${projectId}` : null,
    () => projectService.getWorkItemProperties(workspaceSlug, projectId as string)
  );
  const { isFilterPropertyVisible, isLoading: isFieldVisibilityLoading } = useProjectWorkItemFieldVisibility(
    workspaceSlug,
    projectId
  );
  const filtersToShow = useMemo(() => new Set(allowedFilters), [allowedFilters]);
  const project = useMemo(() => getProjectById(projectId), [projectId, getProjectById]);
  const members: IUserLite[] | undefined = useMemo(
    () =>
      memberIds
        ? (memberIds.map((memberId) => getUserDetails(memberId)).filter((member) => member) as IUserLite[])
        : undefined,
    [memberIds, getUserDetails]
  );
  const workItemStates: IState[] | undefined = useMemo(
    () =>
      stateIds ? (stateIds.map((stateId) => getStateById(stateId)).filter((state) => state) as IState[]) : undefined,
    [stateIds, getStateById]
  );
  const workItemLabels: IIssueLabel[] | undefined = useMemo(
    () =>
      labelIds
        ? (labelIds.map((labelId) => getLabelById(labelId)).filter((label) => label) as IIssueLabel[])
        : undefined,
    [labelIds, getLabelById]
  );
  const cycles = useMemo(
    () => (cycleIds ? (cycleIds.map((cycleId) => getCycleById(cycleId)).filter((cycle) => cycle) as ICycle[]) : []),
    [cycleIds, getCycleById]
  );
  const modules = useMemo(
    () =>
      moduleIds ? (moduleIds.map((moduleId) => getModuleById(moduleId)).filter((module) => module) as IModule[]) : [],
    [moduleIds, getModuleById]
  );
  const projects = useMemo(
    () =>
      projectIds
        ? (projectIds.map((id) => getProjectById(id)).filter((projectDetails) => projectDetails) as IProject[])
        : [],
    [projectIds, getProjectById]
  );
  const areAllConfigsInitialized = useMemo(
    () => isLoaderReady(projectLoader) && (!projectId || (customProperties !== undefined && !isFieldVisibilityLoading)),
    [customProperties, isFieldVisibilityLoading, projectId, projectLoader]
  );

  /**
   * Checks if a filter is enabled based on the filters to show.
   * @param key - The filter key.
   * @param level - The level of the filter.
   * @returns True if the filter is enabled, false otherwise.
   */
  const isFilterEnabled = useCallback(
    (key: TWorkItemFilterProperty) => filtersToShow.has(key) && isFilterPropertyVisible(key),
    [filtersToShow, isFilterPropertyVisible]
  );

  // state group filter config
  const stateGroupFilterConfig = useMemo(
    () =>
      getStateGroupFilterConfig<TWorkItemFilterProperty>("state_group")({
        isEnabled: isFilterEnabled("state_group"),
        filterIcon: StatePropertyIcon,
        getOptionIcon: (stateGroupKey) => <StateGroupIcon stateGroup={stateGroupKey} />,
        ...operatorConfigs,
      }),
    [isFilterEnabled, operatorConfigs]
  );

  // state filter config
  const stateFilterConfig = useMemo(
    () =>
      getStateFilterConfig<TWorkItemFilterProperty>("state_id")({
        isEnabled: isFilterEnabled("state_id") && workItemStates !== undefined,
        filterIcon: StatePropertyIcon,
        getOptionIcon: (state) => <StateGroupIcon stateGroup={state.group} color={state.color} />,
        states: workItemStates ?? [],
        ...operatorConfigs,
      }),
    [isFilterEnabled, workItemStates, operatorConfigs]
  );

  // label filter config
  const labelFilterConfig = useMemo(
    () =>
      getLabelFilterConfig<TWorkItemFilterProperty>("label_id")({
        isEnabled: isFilterEnabled("label_id") && workItemLabels !== undefined,
        filterIcon: LabelPropertyIcon,
        labels: workItemLabels ?? [],
        getOptionIcon: (color) => (
          <span className="flex size-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
        ),
        ...operatorConfigs,
      }),
    [isFilterEnabled, workItemLabels, operatorConfigs]
  );

  // cycle filter config
  const cycleFilterConfig = useMemo(
    () =>
      getCycleFilterConfig<TWorkItemFilterProperty>("cycle_id")({
        isEnabled: isFilterEnabled("cycle_id") && project?.cycle_view === true && cycles !== undefined,
        filterIcon: CycleIcon,
        getOptionIcon: (cycleGroup) => <CycleGroupIcon cycleGroup={cycleGroup} className="h-3.5 w-3.5 flex-shrink-0" />,
        cycles: cycles ?? [],
        ...operatorConfigs,
      }),
    [isFilterEnabled, project?.cycle_view, cycles, operatorConfigs]
  );

  // module filter config
  const moduleFilterConfig = useMemo(
    () =>
      getModuleFilterConfig<TWorkItemFilterProperty>("module_id")({
        isEnabled: isFilterEnabled("module_id") && project?.module_view === true && modules !== undefined,
        filterIcon: ModuleIcon,
        getOptionIcon: () => <ModuleIcon className="h-3 w-3 flex-shrink-0" />,
        modules: modules ?? [],
        ...operatorConfigs,
      }),
    [isFilterEnabled, project?.module_view, modules, operatorConfigs]
  );

  // assignee filter config
  const assigneeFilterConfig = useMemo(
    () =>
      getAssigneeFilterConfig<TWorkItemFilterProperty>("assignee_id")({
        isEnabled: isFilterEnabled("assignee_id") && members !== undefined,
        filterIcon: MembersPropertyIcon,
        members: members ?? [],
        getOptionIcon: (memberDetails) => (
          <Avatar
            name={memberDetails.display_name}
            src={getFileURL(memberDetails.avatar_url)}
            showTooltip={false}
            size="sm"
          />
        ),
        ...operatorConfigs,
      }),
    [isFilterEnabled, members, operatorConfigs]
  );

  // mention filter config
  const mentionFilterConfig = useMemo(
    () =>
      getMentionFilterConfig<TWorkItemFilterProperty>("mention_id")({
        isEnabled: isFilterEnabled("mention_id") && members !== undefined,
        filterIcon: AtSign,
        members: members ?? [],
        getOptionIcon: (memberDetails) => (
          <Avatar
            name={memberDetails.display_name}
            src={getFileURL(memberDetails.avatar_url)}
            showTooltip={false}
            size="sm"
          />
        ),
        ...operatorConfigs,
      }),
    [isFilterEnabled, members, operatorConfigs]
  );

  // created by filter config
  const createdByFilterConfig = useMemo(
    () =>
      getCreatedByFilterConfig<TWorkItemFilterProperty>("created_by_id")({
        isEnabled: isFilterEnabled("created_by_id") && members !== undefined,
        filterIcon: UserCirclePropertyIcon,
        members: members ?? [],
        getOptionIcon: (memberDetails) => (
          <Avatar
            name={memberDetails.display_name}
            src={getFileURL(memberDetails.avatar_url)}
            showTooltip={false}
            size="sm"
          />
        ),
        ...operatorConfigs,
      }),
    [isFilterEnabled, members, operatorConfigs]
  );

  // subscriber filter config
  const subscriberFilterConfig = useMemo(
    () =>
      getSubscriberFilterConfig<TWorkItemFilterProperty>("subscriber_id")({
        isEnabled: isFilterEnabled("subscriber_id") && members !== undefined,
        filterIcon: MembersPropertyIcon,
        members: members ?? [],
        getOptionIcon: (memberDetails) => (
          <Avatar
            name={memberDetails.display_name}
            src={getFileURL(memberDetails.avatar_url)}
            showTooltip={false}
            size="sm"
          />
        ),
        ...operatorConfigs,
      }),
    [isFilterEnabled, members, operatorConfigs]
  );

  // priority filter config
  const priorityFilterConfig = useMemo(
    () =>
      getPriorityFilterConfig<TWorkItemFilterProperty>("priority")({
        isEnabled: isFilterEnabled("priority"),
        filterIcon: PriorityPropertyIcon,
        getOptionIcon: (priority) => <PriorityIcon priority={priority} />,
        ...operatorConfigs,
      }),
    [isFilterEnabled, operatorConfigs]
  );

  // start date filter config
  const startDateFilterConfig = useMemo(
    () =>
      getStartDateFilterConfig<TWorkItemFilterProperty>("start_date")({
        isEnabled: isFilterEnabled("start_date"),
        filterIcon: StartDatePropertyIcon,
        ...operatorConfigs,
      }),
    [isFilterEnabled, operatorConfigs]
  );

  // target date filter config
  const targetDateFilterConfig = useMemo(
    () =>
      getTargetDateFilterConfig<TWorkItemFilterProperty>("target_date")({
        isEnabled: isFilterEnabled("target_date"),
        filterIcon: DueDatePropertyIcon,
        ...operatorConfigs,
      }),
    [isFilterEnabled, operatorConfigs]
  );

  // created at filter config
  const createdAtFilterConfig = useMemo(
    () =>
      getCreatedAtFilterConfig<TWorkItemFilterProperty>("created_at")({
        isEnabled: true,
        filterIcon: CalendarLayoutIcon,
        ...operatorConfigs,
      }),
    [operatorConfigs]
  );

  // updated at filter config
  const updatedAtFilterConfig = useMemo(
    () =>
      getUpdatedAtFilterConfig<TWorkItemFilterProperty>("updated_at")({
        isEnabled: true,
        filterIcon: CalendarLayoutIcon,
        ...operatorConfigs,
      }),
    [operatorConfigs]
  );

  // project filter config
  const projectFilterConfig = useMemo(
    () =>
      getProjectFilterConfig<TWorkItemFilterProperty>("project_id")({
        isEnabled: isFilterEnabled("project_id") && projects !== undefined,
        filterIcon: Briefcase,
        projects: projects,
        getOptionIcon: (projectDetails) => <Logo logo={projectDetails.logo_props} size={12} />,
        ...operatorConfigs,
      }),
    [isFilterEnabled, projects, operatorConfigs]
  );

  const customPropertyFilterConfigs = useMemo(
    () =>
      (customProperties ?? []).map((property: TProjectWorkItemProperty) => {
        const key = `customproperty_${property.id}` as TWorkItemFilterProperty;
        const commonConfig = {
          id: key,
          label: property.name,
          icon: ListChecks,
          isEnabled: true,
          allowMultipleFilters: true,
        };

        if (property.property_type === "SHORT_TEXT" || property.property_type === "LONG_TEXT") {
          return createFilterConfig<TWorkItemFilterProperty>({
            ...commonConfig,
            supportedOperatorConfigsMap: new Map([
              [
                EQUALITY_OPERATOR.CONTAINS,
                createFilterFieldConfig<typeof FILTER_FIELD_TYPE.TEXT, string>({
                  type: FILTER_FIELD_TYPE.TEXT,
                  isOperatorEnabled: true,
                  operatorLabel: "contains",
                  placeholder: "Enter text",
                }),
              ],
            ]),
          });
        }

        if (property.property_type === "NUMBER") {
          return createFilterConfig<TWorkItemFilterProperty>({
            ...commonConfig,
            supportedOperatorConfigsMap: new Map([
              [
                EQUALITY_OPERATOR.EXACT,
                createFilterFieldConfig<typeof FILTER_FIELD_TYPE.NUMBER, number>({
                  type: FILTER_FIELD_TYPE.NUMBER,
                  isOperatorEnabled: true,
                  placeholder: "Enter number",
                }),
              ],
            ]),
          });
        }

        if (property.property_type === "DATE") {
          return getDatePropertyFilterConfig<TWorkItemFilterProperty>(key)({
            isEnabled: true,
            propertyDisplayName: property.name,
            filterIcon: ListChecks,
            ...operatorConfigs,
          });
        }

        if (property.property_type === "CHECKBOX") {
          const items = [
            { id: "true", label: "Yes", value: "true" },
            { id: "false", label: "No", value: "false" },
          ];
          return createFilterConfig<TWorkItemFilterProperty>({
            ...commonConfig,
            supportedOperatorConfigsMap: new Map([
              [
                EQUALITY_OPERATOR.EXACT,
                getSingleSelectConfig(
                  {
                    items,
                    getId: (item) => item.id,
                    getLabel: (item) => item.label,
                    getValue: (item) => item.value,
                  },
                  { isOperatorEnabled: true }
                ),
              ],
            ]),
          });
        }

        const isMemberSelect = property.select_source === "MEMBERS";
        const collectionConfig = isMemberSelect
          ? getMultiSelectConfig(
              {
                items: (members ?? []).filter((member) => member.is_active !== false),
                getId: (member) => member.id,
                getLabel: (member) => member.display_name,
                getValue: (member) => member.id,
              },
              {
                isOperatorEnabled: true,
                singleValueOperator: EQUALITY_OPERATOR.EXACT,
              }
            )
          : getMultiSelectConfig(
              {
                items: property.options.filter((option) => !option.archived_at),
                getId: (option) => option.id,
                getLabel: (option) => option.name,
                getValue: (option) => option.id,
              },
              {
                isOperatorEnabled: true,
                singleValueOperator: EQUALITY_OPERATOR.EXACT,
              }
            );
        return createFilterConfig<TWorkItemFilterProperty>({
          ...commonConfig,
          supportedOperatorConfigsMap: new Map([[COLLECTION_OPERATOR.IN, collectionConfig]]),
        });
      }),
    [customProperties, members, operatorConfigs]
  );

  const customPropertyFilterConfigMap = useMemo(
    () =>
      Object.fromEntries(
        customPropertyFilterConfigs.map((config) => [config.id, config])
      ) as TWorkItemFiltersConfig["configMap"],
    [customPropertyFilterConfigs]
  );

  return {
    areAllConfigsInitialized,
    configs: [
      stateFilterConfig,
      stateGroupFilterConfig,
      assigneeFilterConfig,
      priorityFilterConfig,
      projectFilterConfig,
      mentionFilterConfig,
      labelFilterConfig,
      cycleFilterConfig,
      moduleFilterConfig,
      startDateFilterConfig,
      targetDateFilterConfig,
      createdAtFilterConfig,
      updatedAtFilterConfig,
      createdByFilterConfig,
      subscriberFilterConfig,
      ...customPropertyFilterConfigs,
    ],
    configMap: {
      project_id: projectFilterConfig,
      state_group: stateGroupFilterConfig,
      state_id: stateFilterConfig,
      label_id: labelFilterConfig,
      cycle_id: cycleFilterConfig,
      module_id: moduleFilterConfig,
      assignee_id: assigneeFilterConfig,
      mention_id: mentionFilterConfig,
      created_by_id: createdByFilterConfig,
      subscriber_id: subscriberFilterConfig,
      priority: priorityFilterConfig,
      start_date: startDateFilterConfig,
      target_date: targetDateFilterConfig,
      created_at: createdAtFilterConfig,
      updated_at: updatedAtFilterConfig,
      ...customPropertyFilterConfigMap,
    },
    isFilterEnabled,
    members: members ?? [],
  };
};
