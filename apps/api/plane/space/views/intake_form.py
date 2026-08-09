# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import uuid
from html import escape

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.bgtasks.intake_form_task import (
    notify_intake_form_reviewers,
    send_intake_form_requester_email,
)
from plane.db.models import (
    Cycle,
    CycleIssue,
    FileAsset,
    IntakeForm,
    IntakeFormAccessType,
    IntakeFormEvent,
    IntakeFormPublicStatus,
    IntakeFormSubmission,
    IntakeIssue,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    ProjectMember,
    ProjectWorkItemProperty,
    State,
    StateGroup,
    WorkItemPropertyValue,
    WorkspaceMember,
)
from plane.settings.storage import S3Storage
from plane.license.utils.encryption import encrypt_data
from plane.throttles.intake_form import IntakeFormRateThrottle
from plane.utils.attachments import get_attachment_disposition, validate_project_attachment_size
from plane.utils.content_validator import validate_html_content
from plane.utils.intake_forms import (
    generate_submission_reference,
    generate_tracking_token,
    get_visible_intake_form_field_ids,
    hash_tracking_token,
    render_intake_form_title,
)
from plane.utils.path_validator import sanitize_filename
from plane.utils.work_item_fields import _validate_property_value

from plane.space.serializer.intake_form import serialize_public_intake_form, serialize_public_submission

from .base import BaseAPIView


def _get_form(form_slug, *, include_disabled=False):
    queryset = IntakeForm.objects.select_related("project", "workspace", "intake", "target_state")
    queryset = queryset.filter(slug__iexact=form_slug, deleted_at__isnull=True)
    if not include_disabled:
        queryset = queryset.filter(is_enabled=True, archived_at__isnull=True)
    return get_object_or_404(queryset, project__archived_at__isnull=True)


def _access_denied_response(form, request):
    if form.access_type == IntakeFormAccessType.PUBLIC:
        return None
    if form.access_type == IntakeFormAccessType.AUTHENTICATED:
        if request.user.is_anonymous:
            return Response({"error": "AUTHENTICATION_REQUIRED", "access_type": form.access_type}, status=401)
        if not WorkspaceMember.objects.filter(
            workspace=form.workspace,
            member=request.user,
            is_active=True,
        ).exists():
            return Response({"error": "WORKSPACE_ACCESS_REQUIRED", "access_type": form.access_type}, status=403)
        return None
    access_code = request.headers.get("X-Intake-Code") or request.data.get("access_code", "")
    if not access_code or not check_password(access_code, form.access_code_hash):
        return Response({"error": "ACCESS_CODE_REQUIRED", "access_type": form.access_type}, status=403)
    return None


def _get_triage_state(form):
    state = State.triage_objects.filter(project=form.project).first()
    if state:
        return state
    return State.objects.create(
        name="Triage",
        group=StateGroup.TRIAGE.value,
        project=form.project,
        color="#4E5355",
        sequence=65000,
        default=False,
    )


def _validate_submission_values(form, values):
    if not isinstance(values, dict):
        raise serializers.ValidationError({"values": "Form values must be an object."})
    visible_ids = get_visible_intake_form_field_ids(form, values)
    schema_map = {str(field["id"]): field for field in form.field_schema}
    unknown_ids = set(values) - set(schema_map)
    if unknown_ids:
        raise serializers.ValidationError({"values": {field_id: "Unknown field." for field_id in unknown_ids}})

    errors = {}
    normalized = {}
    custom_properties = {
        str(item.id): item
        for item in ProjectWorkItemProperty.objects.filter(
            project=form.project,
            archived_at__isnull=True,
        ).prefetch_related("options")
    }
    for field_id in visible_ids:
        field = schema_map.get(field_id)
        if not field:
            continue
        value = values.get(field_id)
        is_empty = value is None or value == "" or value == []
        if field.get("required") and is_empty:
            errors[field_id] = "This field is required."
            continue
        if is_empty:
            continue
        if field.get("key") == "requester_email":
            try:
                validate_email(value)
            except DjangoValidationError:
                errors[field_id] = "Enter a valid email address."
                continue
        if field.get("key") == "priority" and value not in {"none", "low", "medium", "high", "urgent"}:
            errors[field_id] = "Select a valid priority."
            continue
        if field.get("source") == "CUSTOM":
            property_instance = custom_properties.get(str(field.get("property_id")))
            if not property_instance:
                errors[field_id] = "This field is no longer available."
                continue
            try:
                value = _validate_property_value(
                    property_instance,
                    value,
                    allow_archived_options=False,
                )
            except ValueError as error:
                errors[field_id] = str(error)
                continue
        normalized[field_id] = value
    if errors:
        raise serializers.ValidationError({"values": errors})
    return normalized


def _apply_hidden_relations(form, issue, hidden_values):
    assignee_ids = hidden_values.get("assignee_ids", [])
    valid_assignees = ProjectMember.objects.filter(
        project=form.project,
        member_id__in=assignee_ids,
        role__gte=15,
        is_active=True,
        member__is_active=True,
        member__blocked_at__isnull=True,
    ).values_list("member_id", flat=True)
    IssueAssignee.objects.bulk_create(
        [
            IssueAssignee(
                workspace=form.workspace,
                project=form.project,
                issue=issue,
                assignee_id=member_id,
            )
            for member_id in valid_assignees
        ]
    )
    label_ids = Label.objects.filter(project=form.project, id__in=hidden_values.get("label_ids", [])).values_list(
        "id", flat=True
    )
    IssueLabel.objects.bulk_create(
        [
            IssueLabel(
                workspace=form.workspace,
                project=form.project,
                issue=issue,
                label_id=label_id,
            )
            for label_id in label_ids
        ]
    )
    cycle = Cycle.objects.filter(
        project=form.project,
        id=hidden_values.get("cycle_id"),
        archived_at__isnull=True,
    ).first()
    if cycle:
        CycleIssue.objects.create(project=form.project, issue=issue, cycle=cycle)
    modules = Module.objects.filter(
        project=form.project,
        id__in=hidden_values.get("module_ids", []),
        archived_at__isnull=True,
    )
    ModuleIssue.objects.bulk_create(
        [
            ModuleIssue(
                workspace=form.workspace,
                project=form.project,
                issue=issue,
                module=module,
            )
            for module in modules
        ]
    )


def _create_submission(form, values, asset_ids, tracking_token, idempotency_key, locale, public_origin):
    schema_map = {str(field["id"]): field for field in form.field_schema}
    hidden_values = form.hidden_values or {}
    by_key = {
        field.get("key"): values.get(field_id, hidden_values.get(field.get("key")))
        for field_id, field in schema_map.items()
    }
    description = str(by_key.get("description") or "")
    description_html = "<p>" + escape(description).replace("\n", "<br>") + "</p>" if description else "<p></p>"
    _, _, sanitized_description = validate_html_content(description_html)
    priority = by_key.get("priority") or hidden_values.get("priority", "none")
    issue = Issue.objects.create(
        project=form.project,
        state=_get_triage_state(form),
        name=render_intake_form_title(form, by_key),
        description_html=sanitized_description or "<p></p>",
        description_json={},
        priority=priority if priority in {"none", "low", "medium", "high", "urgent"} else "none",
        start_date=hidden_values.get("start_date"),
        target_date=hidden_values.get("target_date"),
    )
    intake_issue = IntakeIssue.objects.create(
        project=form.project,
        intake=form.intake,
        issue=issue,
        source="FORMS",
        source_email=str(by_key.get("requester_email") or ""),
        extra={"form_id": str(form.id), "form_name": form.name},
    )
    custom_values = form.hidden_values.get("property_values", {}).copy()
    for field_id, value in values.items():
        field = schema_map[field_id]
        if field.get("source") == "CUSTOM":
            custom_values[str(field["property_id"])] = value
    WorkItemPropertyValue.objects.bulk_create(
        [
            WorkItemPropertyValue(
                workspace=form.workspace,
                project=form.project,
                issue=issue,
                property_id=property_id,
                value=value,
            )
            for property_id, value in custom_values.items()
            if ProjectWorkItemProperty.objects.filter(
                project=form.project,
                id=property_id,
                archived_at__isnull=True,
            ).exists()
        ]
    )
    _apply_hidden_relations(form, issue, hidden_values)
    FileAsset.objects.filter(
        project=form.project,
        id__in=asset_ids,
        entity_identifier=hash_tracking_token(tracking_token),
        is_uploaded=True,
        is_deleted=False,
    ).update(issue=issue, entity_identifier=None)
    reference = generate_submission_reference()
    while IntakeFormSubmission.objects.filter(reference=reference).exists():
        reference = generate_submission_reference()
    submission = IntakeFormSubmission.objects.create(
        project=form.project,
        form=form,
        intake_issue=intake_issue,
        reference=reference,
        tracking_token_hash=hash_tracking_token(tracking_token),
        tracking_token_encrypted=encrypt_data(tracking_token),
        public_origin=public_origin,
        requester_name=str(by_key.get("requester_name") or ""),
        requester_email=str(by_key.get("requester_email") or ""),
        locale=locale,
        submitted_values=values,
        email_notifications_enabled=form.email_notifications_enabled,
        idempotency_key=idempotency_key,
    )
    IntakeFormEvent.objects.create(
        project=form.project,
        submission=submission,
        event_type="SUBMITTED",
        public_status=IntakeFormPublicStatus.RECEIVED,
    )
    notify_intake_form_reviewers(submission, "SUBMITTED")
    send_intake_form_requester_email.delay(str(submission.id), "SUBMITTED")
    return submission


class PublicIntakeFormEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [IntakeFormRateThrottle]

    def get(self, request, form_slug):
        form = _get_form(form_slug)
        denied = _access_denied_response(form, request)
        if denied:
            return denied
        response = Response(
            serialize_public_intake_form(form, tracking_token=generate_tracking_token())
        )
        response["Cache-Control"] = "no-store"
        return response

    @transaction.atomic
    def post(self, request, form_slug):
        form = _get_form(form_slug)
        denied = _access_denied_response(form, request)
        if denied:
            return denied
        if request.data.get("website"):
            return Response({"status": "received"}, status=status.HTTP_202_ACCEPTED)
        idempotency_key = request.headers.get("Idempotency-Key")
        tracking_token = str(request.data.get("tracking_token") or generate_tracking_token())
        if len(tracking_token) < 32:
            return Response({"tracking_token": "Tracking token is invalid."}, status=status.HTTP_400_BAD_REQUEST)
        if idempotency_key:
            existing = IntakeFormSubmission.objects.filter(form=form, idempotency_key=idempotency_key).first()
            if existing:
                if existing.tracking_token_hash != hash_tracking_token(tracking_token):
                    return Response({"error": "IDEMPOTENCY_CONFLICT"}, status=status.HTTP_409_CONFLICT)
                return Response(
                    {
                        "reference": existing.reference,
                        "tracking_token": tracking_token,
                        "tracking_path": f"/support/status/{tracking_token}",
                    }
                )
        values = _validate_submission_values(form, request.data.get("values", {}))
        asset_ids = request.data.get("asset_ids", [])
        if not isinstance(asset_ids, list) or len(asset_ids) > form.max_attachments:
            return Response(
                {"asset_ids": f"Attach no more than {form.max_attachments} files."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        valid_assets = FileAsset.objects.filter(
            project=form.project,
            id__in=asset_ids,
            entity_identifier=hash_tracking_token(tracking_token),
            is_uploaded=True,
            is_deleted=False,
        ).count()
        if valid_assets != len(set(asset_ids)):
            return Response({"asset_ids": "One or more attachments are invalid."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            submission = _create_submission(
                form,
                values,
                asset_ids,
                tracking_token,
                idempotency_key,
                str(request.data.get("locale") or "ru")[:16],
                (settings.SPACE_BASE_URL or request.build_absolute_uri("/")).rstrip("/"),
            )
        except IntegrityError:
            return Response({"error": "The submission could not be created."}, status=status.HTTP_409_CONFLICT)
        return Response(
            {
                "reference": submission.reference,
                "tracking_token": tracking_token,
                "tracking_path": f"/support/status/{tracking_token}",
            },
            status=status.HTTP_201_CREATED,
        )


class PublicIntakeAssetEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [IntakeFormRateThrottle]

    def post(self, request, form_slug):
        form = _get_form(form_slug)
        denied = _access_denied_response(form, request)
        if denied:
            return denied
        tracking_token = str(request.data.get("tracking_token") or "")
        if len(tracking_token) < 32:
            return Response({"tracking_token": "Tracking token is required."}, status=400)
        existing_count = FileAsset.objects.filter(
            project=form.project,
            entity_identifier=hash_tracking_token(tracking_token),
            is_deleted=False,
        ).count()
        if existing_count >= form.max_attachments:
            return Response({"error": "ATTACHMENT_LIMIT_REACHED"}, status=400)
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        mime_type = request.data.get("type", "application/octet-stream")
        size = validate_project_attachment_size(
            project=form.project,
            mime_type=mime_type,
            filename=name,
            size=request.data.get("size"),
        )
        asset_key = f"{form.workspace_id}/{uuid.uuid4().hex}-{name}"
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": mime_type, "size": size},
            asset=asset_key,
            size=size,
            workspace=form.workspace,
            project=form.project,
            user=None,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            entity_identifier=hash_tracking_token(tracking_token),
        )
        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=asset_key,
            file_type=mime_type,
            file_size=size,
        )
        return Response({"asset_id": str(asset.id), "upload_data": upload_data})

    def patch(self, request, form_slug, asset_id):
        form = _get_form(form_slug)
        denied = _access_denied_response(form, request)
        if denied:
            return denied
        tracking_token = str(request.data.get("tracking_token") or "")
        asset = get_object_or_404(
            FileAsset,
            id=asset_id,
            project=form.project,
            entity_identifier=hash_tracking_token(tracking_token),
        )
        asset.is_uploaded = True
        asset.save(update_fields=["is_uploaded", "updated_at"])
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(str(asset.id))
        return Response(status=204)


class PublicIntakeTrackingEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [IntakeFormRateThrottle]

    def _submission(self, tracking_token):
        return get_object_or_404(
            IntakeFormSubmission.objects.select_related("intake_issue__issue", "form", "project"),
            tracking_token_hash=hash_tracking_token(tracking_token),
        )

    def get(self, request, tracking_token):
        return Response(serialize_public_submission(self._submission(tracking_token)))

    def post(self, request, tracking_token):
        submission = self._submission(tracking_token)
        raw_html = str(request.data.get("comment_html") or "").strip()
        is_valid, _, sanitized_html = validate_html_content(raw_html)
        if not raw_html or not is_valid:
            return Response({"comment_html": "Enter a valid comment."}, status=400)
        asset_ids = request.data.get("asset_ids", [])
        if not isinstance(asset_ids, list):
            return Response({"asset_ids": "Attachments must be a list."}, status=400)
        comment = IssueComment.objects.create(
            project=submission.project,
            issue=submission.intake_issue.issue,
            actor=None,
            access="EXTERNAL",
            external_source="INTAKE_FORM",
            external_id=submission.reference,
            comment_html=sanitized_html or "<p></p>",
            comment_json={},
        )
        total_assets = FileAsset.objects.filter(
            issue=submission.intake_issue.issue,
            is_uploaded=True,
            is_deleted=False,
        ).count()
        if len(asset_ids) + total_assets > submission.form.max_attachments:
            comment.delete()
            return Response({"asset_ids": "The request attachment limit has been reached."}, status=400)
        pending_assets = FileAsset.objects.filter(
            project=submission.project,
            id__in=asset_ids,
            entity_identifier=hash_tracking_token(tracking_token),
            is_uploaded=True,
            is_deleted=False,
        )
        if pending_assets.count() != len(set(asset_ids)):
            comment.delete()
            return Response({"asset_ids": "One or more attachments are invalid."}, status=400)
        pending_assets.update(issue=submission.intake_issue.issue, comment=comment, entity_identifier=None)
        IntakeFormEvent.objects.create(
            project=submission.project,
            submission=submission,
            event_type="REQUESTER_COMMENTED",
        )
        notify_intake_form_reviewers(submission, "REQUESTER_COMMENTED")
        return Response(serialize_public_submission(submission), status=201)


class PublicIntakeTrackingAssetEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [IntakeFormRateThrottle]

    def _submission(self, tracking_token):
        return get_object_or_404(
            IntakeFormSubmission.objects.select_related("form", "project", "workspace"),
            tracking_token_hash=hash_tracking_token(tracking_token),
        )

    def post(self, request, tracking_token):
        submission = self._submission(tracking_token)
        form = submission.form
        total_count = FileAsset.objects.filter(
            project=submission.project,
            issue=submission.intake_issue.issue,
            is_uploaded=True,
            is_deleted=False,
        ).count()
        pending_count = FileAsset.objects.filter(
            project=submission.project,
            entity_identifier=submission.tracking_token_hash,
            is_deleted=False,
        ).count()
        if total_count + pending_count >= form.max_attachments:
            return Response({"error": "ATTACHMENT_LIMIT_REACHED"}, status=400)
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        mime_type = request.data.get("type", "application/octet-stream")
        size = validate_project_attachment_size(
            project=submission.project,
            mime_type=mime_type,
            filename=name,
            size=request.data.get("size"),
        )
        asset_key = f"{submission.workspace_id}/{uuid.uuid4().hex}-{name}"
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": mime_type, "size": size},
            asset=asset_key,
            size=size,
            workspace=submission.workspace,
            project=submission.project,
            user=None,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            entity_identifier=submission.tracking_token_hash,
        )
        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=asset_key,
            file_type=mime_type,
            file_size=size,
        )
        return Response({"asset_id": str(asset.id), "upload_data": upload_data})

    def patch(self, request, tracking_token, asset_id):
        submission = self._submission(tracking_token)
        asset = get_object_or_404(
            FileAsset,
            id=asset_id,
            project=submission.project,
            entity_identifier=submission.tracking_token_hash,
        )
        asset.is_uploaded = True
        asset.save(update_fields=["is_uploaded", "updated_at"])
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(str(asset.id))
        return Response(status=204)


class PublicIntakeAssetDownloadEndpoint(BaseAPIView):
    permission_classes = [AllowAny]
    throttle_classes = [IntakeFormRateThrottle]

    def get(self, request, tracking_token, asset_id):
        submission = get_object_or_404(
            IntakeFormSubmission.objects.select_related("intake_issue__issue"),
            tracking_token_hash=hash_tracking_token(tracking_token),
        )
        asset = get_object_or_404(
            FileAsset,
            id=asset_id,
            issue=submission.intake_issue.issue,
            is_uploaded=True,
            is_deleted=False,
        )
        mime_type = asset.attributes.get("type", "application/octet-stream")
        disposition = get_attachment_disposition(mime_type, request.query_params.get("disposition", "attachment"))
        signed_url = S3Storage(request=request).generate_presigned_url(
            object_name=asset.asset.name,
            disposition=disposition,
            filename=asset.attributes.get("name", "file"),
        )
        return HttpResponseRedirect(signed_url)
