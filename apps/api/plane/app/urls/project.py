# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    ProjectViewSet,
    DeployBoardViewSet,
    ProjectInvitationsViewset,
    ProjectMemberViewSet,
    ProjectMemberUserEndpoint,
    ProjectJoinEndpoint,
    ProjectUserViewsEndpoint,
    ProjectIdentifierEndpoint,
    ProjectFavoritesViewSet,
    UserProjectInvitationsViewset,
    UserProjectRolesEndpoint,
    ProjectArchiveUnarchiveEndpoint,
    ProjectMemberPreferenceEndpoint,
    ProjectAttachmentSettingsEndpoint,
    ProjectWorkItemFieldConfigurationEndpoint,
    ProjectWorkItemPropertyViewSet,
    ProjectAvailableStateTransitionsEndpoint,
    ProjectStateTransitionAuditLogViewSet,
    ProjectStateTransitionPreviewEndpoint,
    ProjectStateTransitionRuleViewSet,
    ProjectStateTransitionSettingsEndpoint,
    ProjectUserGroupViewSet,
    ProjectCustomGroupingPreferenceEndpoint,
    ProjectCustomGroupingViewSet,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/",
        ProjectViewSet.as_view({"get": "list", "post": "create"}),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/details/",
        ProjectViewSet.as_view({"get": "list_detail"}),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:pk>/",
        ProjectViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/project-identifiers/",
        ProjectIdentifierEndpoint.as_view(),
        name="project-identifiers",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/invitations/",
        ProjectInvitationsViewset.as_view({"get": "list", "post": "create"}),
        name="project-member-invite",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/invitations/<uuid:pk>/",
        ProjectInvitationsViewset.as_view({"get": "retrieve", "delete": "destroy"}),
        name="project-member-invite",
    ),
    path(
        "users/me/workspaces/<str:slug>/projects/invitations/",
        UserProjectInvitationsViewset.as_view({"get": "list", "post": "create"}),
        name="user-project-invitations",
    ),
    path(
        "users/me/workspaces/<str:slug>/project-roles/",
        UserProjectRolesEndpoint.as_view(),
        name="user-project-roles",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/join/<uuid:pk>/",
        ProjectJoinEndpoint.as_view(),
        name="project-join",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/",
        ProjectMemberViewSet.as_view({"get": "list", "post": "create"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/",
        ProjectMemberViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/leave/",
        ProjectMemberViewSet.as_view({"post": "leave"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-views/",
        ProjectUserViewsEndpoint.as_view(),
        name="project-view",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-members/me/",
        ProjectMemberUserEndpoint.as_view(),
        name="project-member-view",
    ),
    path(
        "workspaces/<str:slug>/user-favorite-projects/",
        ProjectFavoritesViewSet.as_view({"get": "list", "post": "create"}),
        name="project-favorite",
    ),
    path(
        "workspaces/<str:slug>/user-favorite-projects/<uuid:project_id>/",
        ProjectFavoritesViewSet.as_view({"delete": "destroy"}),
        name="project-favorite",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/",
        DeployBoardViewSet.as_view({"get": "list", "post": "create"}),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/<uuid:pk>/",
        DeployBoardViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/archive/",
        ProjectArchiveUnarchiveEndpoint.as_view(),
        name="project-archive-unarchive",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/preferences/member/<uuid:member_id>/",
        ProjectMemberPreferenceEndpoint.as_view(),
        name="project-member-preference",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/attachment-settings/",
        ProjectAttachmentSettingsEndpoint.as_view(),
        name="project-attachment-settings",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-item-fields/configuration/",
        ProjectWorkItemFieldConfigurationEndpoint.as_view(),
        name="project-work-item-field-configuration",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-item-fields/properties/",
        ProjectWorkItemPropertyViewSet.as_view(
            {
                "get": "list",
                "post": "create",
            }
        ),
        name="project-work-item-property",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-item-fields/properties/<uuid:pk>/",
        ProjectWorkItemPropertyViewSet.as_view(
            {
                "get": "retrieve",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-work-item-property-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/settings/",
        ProjectStateTransitionSettingsEndpoint.as_view(),
        name="project-state-transition-settings",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/rules/",
        ProjectStateTransitionRuleViewSet.as_view(
            {
                "get": "list",
                "post": "create",
            }
        ),
        name="project-state-transition-rule",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/rules/<uuid:pk>/",
        ProjectStateTransitionRuleViewSet.as_view(
            {
                "get": "retrieve",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-state-transition-rule-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/audit-logs/",
        ProjectStateTransitionAuditLogViewSet.as_view({"get": "list"}),
        name="project-state-transition-audit-log",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/preview/",
        ProjectStateTransitionPreviewEndpoint.as_view(),
        name="project-state-transition-preview",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/state-transitions/available/",
        ProjectAvailableStateTransitionsEndpoint.as_view(),
        name="project-state-transition-available",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-groups/",
        ProjectUserGroupViewSet.as_view({"get": "list", "post": "create"}),
        name="project-user-group",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-groupings/",
        ProjectCustomGroupingViewSet.as_view({"get": "list", "post": "create"}),
        name="project-custom-grouping",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-groupings/<uuid:pk>/",
        ProjectCustomGroupingViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="project-custom-grouping-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-groupings/preference/",
        ProjectCustomGroupingPreferenceEndpoint.as_view(),
        name="project-custom-grouping-preference",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-groups/<uuid:pk>/",
        ProjectUserGroupViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-user-group-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-groups/<uuid:pk>/restore/",
        ProjectUserGroupViewSet.as_view({"post": "restore"}),
        name="project-user-group-restore",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-groups/<uuid:pk>/members/",
        ProjectUserGroupViewSet.as_view({"patch": "update_members"}),
        name="project-user-group-members",
    ),
]
