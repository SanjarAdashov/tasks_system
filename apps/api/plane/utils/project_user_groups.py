from copy import deepcopy

from django.db import transaction

from plane.db.models import (
    ProjectStateTransitionRule,
    ProjectStateTransitionSettings,
    ProjectUserGroup,
    ProjectUserGroupMember,
)


def _remap_group_values(node, group_id_map):
    node = deepcopy(node)
    if not isinstance(node, dict):
        return node
    if node.get("kind") == "condition":
        field = node.get("field", "")
        if field.endswith(".group") or ".group_" in field:
            mapped = group_id_map.get(str(node.get("value")))
            if mapped:
                node["value"] = str(mapped)
        return node
    node["children"] = [_remap_group_values(child, group_id_map) for child in node.get("children") or []]
    return node


@transaction.atomic
def copy_project_user_groups_and_transition_rules(*, source_project, target_project, state_id_map):
    """Copy groups, retained membership, and transition rules during project duplication.

    ``state_id_map`` maps source state UUID strings to the newly-created state
    UUIDs. Non-project members are deliberately retained in copied groups and
    will be marked as such by the API until they are added to the target.
    """

    group_id_map = {}
    for source_group in ProjectUserGroup.all_objects.filter(
        project=source_project,
        deleted_at__isnull=True,
    ).order_by("created_at"):
        target_group = ProjectUserGroup.objects.create(
            workspace=target_project.workspace,
            project=target_project,
            name=source_group.name,
            description=source_group.description,
            archived_at=source_group.archived_at,
        )
        group_id_map[str(source_group.id)] = target_group.id
        ProjectUserGroupMember.objects.bulk_create(
            [
                ProjectUserGroupMember(
                    workspace=target_project.workspace,
                    project=target_project,
                    group=target_group,
                    member_id=member_id,
                )
                for member_id in source_group.memberships.values_list("member_id", flat=True)
            ]
        )

    source_settings = ProjectStateTransitionSettings.objects.filter(project=source_project).first()
    if source_settings:
        ProjectStateTransitionSettings.objects.update_or_create(
            project=target_project,
            defaults={"workspace": target_project.workspace, "strict_mode": source_settings.strict_mode},
        )

    copied_rules = []
    for source_rule in ProjectStateTransitionRule.all_objects.filter(
        project=source_project,
        deleted_at__isnull=True,
    ):
        source_state_id = state_id_map.get(str(source_rule.source_state_id)) if source_rule.source_state_id else None
        target_state_id = state_id_map.get(str(source_rule.target_state_id))
        if not target_state_id or (source_rule.source_state_id and not source_state_id):
            continue
        copied_rules.append(
            ProjectStateTransitionRule(
                workspace=target_project.workspace,
                project=target_project,
                source_type=source_rule.source_type,
                source_state_id=source_state_id,
                target_state_id=target_state_id,
                allow_conditions=_remap_group_values(source_rule.allow_conditions, group_id_map),
                deny_conditions=_remap_group_values(source_rule.deny_conditions, group_id_map),
                validation_conditions=_remap_group_values(source_rule.validation_conditions, group_id_map),
                project_admin_bypass=source_rule.project_admin_bypass,
                system_bypass=source_rule.system_bypass,
                archived_at=source_rule.archived_at,
            )
        )
    ProjectStateTransitionRule.objects.bulk_create(copied_rules)
    return group_id_map
