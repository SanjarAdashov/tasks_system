from collections import defaultdict
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from bs4 import BeautifulSoup

from plane.db.models.project import ROLE


def is_instance_admin(user):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    from plane.license.models import InstanceAdmin

    return InstanceAdmin.objects.filter(user_id=user.id).exists()


def is_project_admin(user, project_id):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    from plane.db.models import ProjectMember

    return ProjectMember.objects.filter(
        project_id=project_id,
        member_id=user.id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists()


def is_workspace_admin(user, workspace_id):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    from plane.db.models import WorkspaceMember

    return WorkspaceMember.objects.filter(
        workspace_id=workspace_id,
        member_id=user.id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists()


def filter_issues_visible_to(queryset, user):
    """Apply the complete restricted-task policy to an arbitrary Issue queryset."""
    from plane.db.models import ProjectMember, WorkspaceMember
    from plane.db.models.issue import IssueVisibility

    if user is None:
        # Celery and trusted internal maintenance have no request user and need
        # an unscoped view. Public requests carry AnonymousUser instead.
        return queryset
    if not getattr(user, "is_authenticated", False):
        return queryset.filter(visibility=IssueVisibility.PROJECT)
    if is_instance_admin(user):
        return queryset

    active_project_ids = ProjectMember.objects.filter(member_id=user.id, is_active=True).values("project_id")
    project_admin_ids = ProjectMember.objects.filter(
        member_id=user.id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).values("project_id")
    workspace_admin_ids = WorkspaceMember.objects.filter(
        member_id=user.id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).values("workspace_id")
    user_id = str(user.id)

    own_access = (
        Q(
            issue_assignee__assignee_id=user.id,
            issue_assignee__deleted_at__isnull=True,
        )
        | Q(
            work_item_property_values__property__select_source="MEMBERS",
            work_item_property_values__property__archived_at__isnull=True,
            work_item_property_values__property__deleted_at__isnull=True,
            work_item_property_values__deleted_at__isnull=True,
            work_item_property_values__value=user_id,
        )
        | Q(
            work_item_property_values__property__select_source="MEMBERS",
            work_item_property_values__property__archived_at__isnull=True,
            work_item_property_values__property__deleted_at__isnull=True,
            work_item_property_values__deleted_at__isnull=True,
            work_item_property_values__value__contains=[user_id],
        )
        | Q(
            access_group_links__deleted_at__isnull=True,
            access_group_links__group__archived_at__isnull=True,
            access_group_links__group__deleted_at__isnull=True,
            access_group_links__group__memberships__member_id=user.id,
            access_group_links__group__memberships__deleted_at__isnull=True,
        )
    )
    inherited_access = (
        Q(
            access_source__issue_assignee__assignee_id=user.id,
            access_source__issue_assignee__deleted_at__isnull=True,
        )
        | Q(
            access_source__work_item_property_values__property__select_source="MEMBERS",
            access_source__work_item_property_values__property__archived_at__isnull=True,
            access_source__work_item_property_values__property__deleted_at__isnull=True,
            access_source__work_item_property_values__deleted_at__isnull=True,
            access_source__work_item_property_values__value=user_id,
        )
        | Q(
            access_source__work_item_property_values__property__select_source="MEMBERS",
            access_source__work_item_property_values__property__archived_at__isnull=True,
            access_source__work_item_property_values__property__deleted_at__isnull=True,
            access_source__work_item_property_values__deleted_at__isnull=True,
            access_source__work_item_property_values__value__contains=[user_id],
        )
        | Q(
            access_source__access_group_links__deleted_at__isnull=True,
            access_source__access_group_links__group__archived_at__isnull=True,
            access_source__access_group_links__group__deleted_at__isnull=True,
            access_source__access_group_links__group__memberships__member_id=user.id,
            access_source__access_group_links__group__memberships__deleted_at__isnull=True,
        )
    )

    return queryset.filter(
        Q(visibility=IssueVisibility.PROJECT)
        | Q(created_by_id=user.id)
        | Q(access_source__created_by_id=user.id)
        | Q(project_id__in=project_admin_ids)
        | Q(workspace_id__in=workspace_admin_ids)
        | (Q(project_id__in=active_project_ids) & (own_access | inherited_access))
    ).distinct()


def can_view_issue(user, issue):
    from plane.db.models import Issue

    return filter_issues_visible_to(Issue.unscoped_objects.filter(id=issue.id), user).exists()


def can_manage_issue_access(user, issue):
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and (issue.created_by_id == user.id or is_project_admin(user, issue.project_id))
    )


def issue_acl_source(issue):
    return issue.access_source if issue.access_source_id else issue


def issue_effective_user_ids(issue):
    """Return active project-member IDs granted by the issue's dynamic ACL."""
    from plane.db.models import IssueAccessGroup, ProjectMember

    source = issue_acl_source(issue)
    active_member_ids = set(
        ProjectMember.objects.filter(
            project_id=issue.project_id,
            is_active=True,
            member__is_active=True,
        ).values_list("member_id", flat=True)
    )
    user_ids = {source.created_by_id} if source.created_by_id else set()
    user_ids.update(source.issue_assignee.values_list("assignee_id", flat=True))
    for values in member_property_user_ids(source).values():
        user_ids.update(normalize_uuid_set(values))
    group_ids = IssueAccessGroup.objects.filter(issue=source).values_list("group_id", flat=True)
    from plane.db.models import ProjectUserGroupMember

    user_ids.update(
        ProjectUserGroupMember.objects.filter(
            group_id__in=group_ids,
            member_id__in=active_member_ids,
        ).values_list("member_id", flat=True)
    )
    return user_ids & active_member_ids


def issue_authorized_user_ids(issue):
    """Return every user ID that can currently view a restricted issue."""
    from plane.db.models import ProjectMember, WorkspaceMember
    from plane.license.models import InstanceAdmin

    user_ids = issue_effective_user_ids(issue)
    if issue.created_by_id:
        user_ids.add(issue.created_by_id)
    user_ids.update(
        ProjectMember.objects.filter(
            project_id=issue.project_id,
            role=ROLE.ADMIN.value,
            is_active=True,
            member__is_active=True,
        ).values_list("member_id", flat=True)
    )
    user_ids.update(
        WorkspaceMember.objects.filter(
            workspace_id=issue.workspace_id,
            role=ROLE.ADMIN.value,
            is_active=True,
            member__is_active=True,
        ).values_list("member_id", flat=True)
    )
    user_ids.update(InstanceAdmin.objects.filter(user__is_active=True).values_list("user_id", flat=True))
    return user_ids


def administrative_user_ids(*, project_id, workspace_id):
    from plane.db.models import ProjectMember, WorkspaceMember
    from plane.license.models import InstanceAdmin

    return (
        set(
            ProjectMember.objects.filter(
                project_id=project_id,
                role=ROLE.ADMIN.value,
                is_active=True,
                member__is_active=True,
            ).values_list("member_id", flat=True)
        )
        | set(
            WorkspaceMember.objects.filter(
                workspace_id=workspace_id,
                role=ROLE.ADMIN.value,
                is_active=True,
                member__is_active=True,
            ).values_list("member_id", flat=True)
        )
        | set(InstanceAdmin.objects.filter(user__is_active=True).values_list("user_id", flat=True))
    )


def extract_mentioned_user_ids(html):
    if not html:
        return set()
    soup = BeautifulSoup(str(html), "html.parser")
    values = [
        tag.get("entity_identifier")
        for tag in soup.find_all("mention-component", attrs={"entity_name": "user_mention"})
    ]
    return normalize_uuid_set(value for value in values if value)


def unauthorized_mention_user_ids(issue, html):
    if issue.visibility != "RESTRICTED":
        return set()
    return extract_mentioned_user_ids(html) - issue_authorized_user_ids(issue)


def propagate_inherited_access(issue):
    """Keep inheriting descendants on the same effective ACL source."""
    from plane.db.models import Issue, IssueVisibility

    source_id = issue.access_source_id or issue.id
    frontier = [issue.id]
    while frontier:
        child_ids = list(
            Issue.unscoped_objects.filter(
                parent_id__in=frontier,
                inherit_parent_access=True,
                deleted_at__isnull=True,
            ).values_list("id", flat=True)
        )
        if not child_ids:
            break
        Issue.unscoped_objects.filter(id__in=child_ids).update(
            visibility=IssueVisibility.RESTRICTED,
            access_source_id=source_id,
        )
        frontier = child_ids


def normalize_uuid_set(values):
    result = set()
    for value in values or []:
        try:
            result.add(UUID(str(value)))
        except (TypeError, ValueError, AttributeError):
            continue
    return result


def validate_issue_access_groups(*, project_id, group_ids):
    from rest_framework import serializers
    from plane.db.models import ProjectUserGroup

    normalized = normalize_uuid_set(group_ids)
    valid_ids = set(
        ProjectUserGroup.objects.filter(
            project_id=project_id,
            id__in=normalized,
            archived_at__isnull=True,
        ).values_list("id", flat=True)
    )
    if valid_ids != normalized:
        raise serializers.ValidationError({"access_group_ids": "One or more groups are invalid or archived."})
    return valid_ids


def record_issue_access_event(*, issue, actor, action, source_type, source_id=None, details=None):
    from plane.db.models import IssueAccessAuditLog

    return IssueAccessAuditLog.objects.create(
        issue=issue,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        source_type=source_type,
        source_id=source_id,
        details=details or {},
        project_id=issue.project_id,
        workspace_id=issue.workspace_id,
    )


@transaction.atomic
def sync_issue_access_groups(*, issue, group_ids, actor):
    from plane.db.models import (
        IssueAccessAuditAction,
        IssueAccessGroup,
        IssueAccessSourceType,
    )

    desired = validate_issue_access_groups(project_id=issue.project_id, group_ids=group_ids)
    current = set(IssueAccessGroup.objects.filter(issue=issue).values_list("group_id", flat=True))
    added = desired - current
    removed = current - desired
    if removed:
        IssueAccessGroup.objects.filter(issue=issue, group_id__in=removed).delete()
    if added:
        IssueAccessGroup.objects.bulk_create(
            [
                IssueAccessGroup(
                    issue=issue,
                    group_id=group_id,
                    project_id=issue.project_id,
                    workspace_id=issue.workspace_id,
                    created_by_id=getattr(actor, "id", None),
                )
                for group_id in added
            ],
            ignore_conflicts=True,
        )
    if added or removed:
        record_issue_access_event(
            issue=issue,
            actor=actor,
            action=IssueAccessAuditAction.GROUPS_CHANGED,
            source_type=IssueAccessSourceType.USER_GROUP,
            details={
                "added_group_ids": sorted(str(value) for value in added),
                "removed_group_ids": sorted(str(value) for value in removed),
            },
        )


def member_property_user_ids(issue):
    from plane.db.models import WorkItemPropertyValue, WorkItemSelectSource

    result = defaultdict(set)
    values = WorkItemPropertyValue.objects.filter(
        issue=issue,
        property__select_source=WorkItemSelectSource.MEMBERS,
        property__archived_at__isnull=True,
    ).select_related("property")
    for stored in values:
        raw_values = stored.value if isinstance(stored.value, list) else [stored.value]
        result[str(stored.property_id)].update(str(value) for value in raw_values if value)
    return result


def record_project_membership_access_events(*, project, user_id, actor, is_active):
    """Record restricted tasks whose effective ACL is affected by project membership."""
    from plane.db.models import (
        Issue,
        IssueAccessAuditAction,
        IssueAccessGroup,
        IssueAccessSourceType,
        IssueAssignee,
        ProjectUserGroupMember,
        WorkItemPropertyValue,
        WorkItemSelectSource,
    )

    source_issue_ids = set(
        IssueAssignee.objects.filter(project=project, assignee_id=user_id).values_list("issue_id", flat=True)
    )
    member_group_ids = ProjectUserGroupMember.all_objects.filter(
        project=project,
        member_id=user_id,
        deleted_at__isnull=True,
    ).values_list("group_id", flat=True)
    source_issue_ids.update(
        IssueAccessGroup.objects.filter(project=project, group_id__in=member_group_ids).values_list(
            "issue_id", flat=True
        )
    )
    for stored_value in WorkItemPropertyValue.objects.filter(
        project=project,
        property__select_source=WorkItemSelectSource.MEMBERS,
        property__archived_at__isnull=True,
    ).only("issue_id", "value"):
        raw_values = stored_value.value if isinstance(stored_value.value, list) else [stored_value.value]
        if str(user_id) in {str(value) for value in raw_values if value}:
            source_issue_ids.add(stored_value.issue_id)

    affected_issues = Issue.unscoped_objects.filter(
        Q(id__in=source_issue_ids) | Q(access_source_id__in=source_issue_ids),
        project=project,
        visibility="RESTRICTED",
    ).distinct()
    for issue in affected_issues:
        record_issue_access_event(
            issue=issue,
            actor=actor,
            action=IssueAccessAuditAction.GROUP_MEMBERS_CHANGED,
            source_type=IssueAccessSourceType.GROUP_MEMBERSHIP,
            source_id=user_id,
            details={
                "project_membership_active": bool(is_active),
                "user_id": str(user_id),
            },
        )


def issue_access_summary(issue):
    from plane.db.models import IssueAccessGroup, ProjectMember, User

    source = issue_acl_source(issue)
    sources = defaultdict(list)
    if source.created_by_id:
        sources[str(source.created_by_id)].append({"type": "CREATOR", "label": "Creator"})
    if source.id != issue.id and issue.created_by_id:
        sources[str(issue.created_by_id)].append({"type": "CREATOR", "label": "Sub-task creator"})
    for assignee_id in source.issue_assignee.values_list("assignee_id", flat=True):
        sources[str(assignee_id)].append({"type": "ASSIGNEE", "label": "Assignee"})
    property_names = {
        str(value.property_id): value.property.name
        for value in source.work_item_property_values.select_related("property").filter(
            property__select_source="MEMBERS",
            property__archived_at__isnull=True,
        )
    }
    for property_id, user_ids in member_property_user_ids(source).items():
        for user_id in user_ids:
            sources[user_id].append(
                {"type": "MEMBER_PROPERTY", "label": property_names.get(property_id, "Member field")}
            )
    active_member_ids = set(
        ProjectMember.objects.filter(project_id=issue.project_id, is_active=True).values_list("member_id", flat=True)
    )
    groups = (
        IssueAccessGroup.objects.filter(issue=source).select_related("group").prefetch_related("group__memberships")
    )
    group_payload = []
    for link in groups:
        member_ids = [
            membership.member_id
            for membership in link.group.memberships.all()
            if membership.member_id in active_member_ids and membership.deleted_at is None
        ]
        group_payload.append(
            {"id": str(link.group_id), "name": link.group.name, "member_ids": [str(value) for value in member_ids]}
        )
        for member_id in member_ids:
            sources[str(member_id)].append({"type": "USER_GROUP", "label": link.group.name})

    users = User.objects.filter(id__in=sources.keys())
    user_payload = [
        {
            "id": str(user.id),
            "first_name": user.first_name,
            "last_name": user.last_name,
            "avatar_url": user.avatar_url,
            "sources": sources[str(user.id)],
        }
        for user in users
    ]
    return {
        "users": user_payload,
        "groups": group_payload,
        "inherited": source.id != issue.id,
        "source_issue_id": str(source.id),
    }
