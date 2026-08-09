# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from plane.db.models import (
    IntakeFormEvent,
    IntakeFormPublicStatus,
    ProjectMember,
    ProjectWorkItemProperty,
    StateGroup,
    WorkItemSelectSource,
    WorkItemPropertyType,
)


def sync_public_submission_status(submission):
    intake_issue = submission.intake_issue
    issue = intake_issue.issue
    mapping = submission.form.public_status_mapping or {}
    status_keys = {-2: "PENDING", -1: "REJECTED", 0: "SNOOZED", 1: "ACCEPTED", 2: "DUPLICATE"}
    public_status = mapping.get(status_keys.get(intake_issue.status), submission.public_status)
    state_mapping = mapping.get("state_ids", {})
    if intake_issue.status == 1:
        public_status = state_mapping.get(str(issue.state_id), public_status)
        if issue.state and issue.state.group == StateGroup.COMPLETED:
            public_status = IntakeFormPublicStatus.COMPLETED
        elif issue.state and issue.state.group == StateGroup.CANCELLED:
            public_status = IntakeFormPublicStatus.REJECTED
    if public_status not in IntakeFormPublicStatus.values:
        public_status = submission.public_status
    if public_status != submission.public_status:
        submission.public_status = public_status
        submission.save(update_fields=["public_status", "updated_at"])
        IntakeFormEvent.objects.create(
            project=submission.project,
            submission=submission,
            event_type="STATUS_CHANGED",
            public_status=public_status,
        )
    return public_status


def serialize_public_intake_form(form, tracking_token=None):
    conditional_field_ids = {
        str(condition.get("target_field_id"))
        for condition in form.conditions
        if condition.get("action", "SHOW") == "SHOW"
    }
    property_ids = [
        field.get("property_id")
        for field in form.field_schema
        if field.get("source") == "CUSTOM"
        and (field.get("visible", True) or str(field.get("id")) in conditional_field_ids)
    ]
    properties = {
        str(item.id): item
        for item in ProjectWorkItemProperty.objects.filter(
            project=form.project,
            id__in=property_ids,
            archived_at__isnull=True,
        ).prefetch_related("options")
    }
    member_options = None
    fields = []
    for field in form.field_schema:
        if not field.get("visible", True) and str(field.get("id")) not in conditional_field_ids:
            continue
        data = dict(field)
        if data.get("source") == "CUSTOM":
            property_instance = properties.get(str(data.get("property_id")))
            if not property_instance:
                continue
            if property_instance.select_source == WorkItemSelectSource.MEMBERS:
                if member_options is None:
                    member_options = [
                        {
                            "id": str(project_member.member_id),
                            "name": project_member.member.display_name,
                        }
                        for project_member in ProjectMember.objects.filter(
                            project=form.project,
                            is_active=True,
                            role__gte=15,
                            member__is_active=True,
                            member__blocked_at__isnull=True,
                        )
                        .select_related("member")
                        .order_by("member__display_name", "member_id")
                    ]
                options = member_options
            elif property_instance.property_type in {
                WorkItemPropertyType.SINGLE_SELECT,
                WorkItemPropertyType.MULTI_SELECT,
            }:
                options = [
                    {"id": str(option.id), "name": option.name}
                    for option in property_instance.options.filter(archived_at__isnull=True)
                ]
            else:
                options = []
            data.update(
                {
                    "name": property_instance.name,
                    "description": property_instance.description,
                    "property_type": property_instance.property_type,
                    "options": options,
                }
            )
        fields.append(data)
    return {
        "id": str(form.id),
        "name": form.name,
        "description": form.description,
        "slug": form.slug,
        "access_type": form.access_type,
        "project": {
            "name": form.project.name,
            "identifier": form.project.identifier,
            "emoji": form.project.emoji,
            "icon_prop": form.project.icon_prop,
            "cover_image": form.project.cover_image,
        },
        "fields": fields,
        "conditions": form.conditions,
        "branding": form.branding,
        "translations": form.translations,
        "max_attachments": form.max_attachments,
        "email_notifications_enabled": form.email_notifications_enabled,
        "supported_locales": ["ru", "uz", "en"],
        "tracking_token": tracking_token,
    }


def serialize_public_submission(submission):
    sync_public_submission_status(submission)
    issue = submission.intake_issue.issue
    comments = issue.issue_comments.filter(access="EXTERNAL").order_by("created_at")
    events = submission.events.filter(deleted_at__isnull=True).order_by("created_at")
    attachments = issue.assets.filter(
        entity_type="ISSUE_ATTACHMENT",
        is_uploaded=True,
        is_deleted=False,
    )
    return {
        "reference": submission.reference,
        "form_slug": submission.form.slug,
        "success_message": (
            submission.form.translations.get(submission.locale, {}).get("success_message")
            or submission.form.branding.get("success_message", "")
        ),
        "public_status": submission.public_status,
        "title": issue.name,
        "created_at": submission.created_at,
        "updated_at": submission.updated_at,
        "comments": [
            {
                "id": str(comment.id),
                "comment_html": comment.comment_html,
                "created_at": comment.created_at,
                "edited_at": comment.edited_at,
                "author": (
                    comment.actor.display_name
                    if comment.actor_id
                    else submission.requester_name or submission.requester_email or "Requester"
                ),
            }
            for comment in comments
        ],
        "events": [
            {
                "id": str(event.id),
                "event_type": event.event_type,
                "public_status": event.public_status,
                "message": event.message,
                "created_at": event.created_at,
            }
            for event in events
        ],
        "attachments": [
            {
                "id": str(asset.id),
                "name": asset.attributes.get("name", "file"),
                "type": asset.attributes.get("type", "application/octet-stream"),
                "size": asset.size,
            }
            for asset in attachments
        ],
    }
