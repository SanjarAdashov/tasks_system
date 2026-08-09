# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models
from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.db.models.signals import post_save
from django.dispatch import receiver

from .project import ProjectBaseModel


def get_default_intake_form_fields():
    return [
        {
            "id": "requester_name",
            "source": "FORM",
            "key": "requester_name",
            "visible": True,
            "required": False,
            "sort_order": 1000,
        },
        {
            "id": "requester_email",
            "source": "FORM",
            "key": "requester_email",
            "visible": True,
            "required": False,
            "sort_order": 2000,
        },
        {
            "id": "title",
            "source": "SYSTEM",
            "key": "title",
            "visible": True,
            "required": True,
            "sort_order": 3000,
        },
        {
            "id": "description",
            "source": "SYSTEM",
            "key": "description",
            "visible": True,
            "required": False,
            "sort_order": 4000,
        },
    ]


def get_default_public_status_mapping():
    return {
        "PENDING": "RECEIVED",
        "SNOOZED": "UNDER_REVIEW",
        "ACCEPTED": "IN_PROGRESS",
        "REJECTED": "REJECTED",
        "DUPLICATE": "COMPLETED",
        "state_ids": {},
    }


class IntakeFormAccessType(models.TextChoices):
    PUBLIC = "PUBLIC", "Public"
    CODE = "CODE", "Access code"
    AUTHENTICATED = "AUTHENTICATED", "Workspace users"


class IntakeFormPublicStatus(models.TextChoices):
    RECEIVED = "RECEIVED", "Received"
    UNDER_REVIEW = "UNDER_REVIEW", "Under review"
    IN_PROGRESS = "IN_PROGRESS", "In progress"
    COMPLETED = "COMPLETED", "Completed"
    REJECTED = "REJECTED", "Rejected"


class IntakeForm(ProjectBaseModel):
    intake = models.ForeignKey(
        "db.Intake",
        on_delete=models.CASCADE,
        related_name="forms",
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=120)
    description = models.TextField(blank=True, default="")
    is_enabled = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    access_type = models.CharField(
        max_length=24,
        choices=IntakeFormAccessType.choices,
        default=IntakeFormAccessType.PUBLIC,
    )
    access_code_hash = models.CharField(max_length=255, blank=True, default="")
    target_state = models.ForeignKey(
        "db.State",
        on_delete=models.SET_NULL,
        related_name="intake_forms",
        null=True,
        blank=True,
    )
    reviewer_group = models.ForeignKey(
        "db.ProjectUserGroup",
        on_delete=models.SET_NULL,
        related_name="intake_forms",
        null=True,
        blank=True,
    )
    field_schema = models.JSONField(default=get_default_intake_form_fields)
    hidden_values = models.JSONField(default=dict, blank=True)
    conditions = models.JSONField(default=list, blank=True)
    branding = models.JSONField(default=dict, blank=True)
    translations = models.JSONField(default=dict, blank=True)
    public_status_mapping = models.JSONField(default=get_default_public_status_mapping)
    title_template = models.CharField(
        max_length=500,
        default="Request from {requester_name}: {short_description}",
    )
    email_notifications_enabled = models.BooleanField(default=False)
    max_attachments = models.PositiveSmallIntegerField(default=20)

    class Meta:
        verbose_name = "Intake Form"
        verbose_name_plural = "Intake Forms"
        db_table = "intake_forms"
        ordering = ("name", "created_at")
        constraints = [
            models.UniqueConstraint(
                Lower("slug"),
                condition=Q(deleted_at__isnull=True),
                name="unique_active_intake_form_slug",
            ),
            models.CheckConstraint(
                condition=Q(max_attachments__gte=1, max_attachments__lte=20),
                name="intake_form_max_attachments_between_1_and_20",
            ),
        ]

    def __str__(self):
        return f"{self.name} <{self.slug}>"


class IntakeFormSubmission(ProjectBaseModel):
    form = models.ForeignKey(
        IntakeForm,
        on_delete=models.PROTECT,
        related_name="submissions",
    )
    intake_issue = models.OneToOneField(
        "db.IntakeIssue",
        on_delete=models.CASCADE,
        related_name="form_submission",
    )
    reference = models.CharField(max_length=32, unique=True)
    tracking_token_hash = models.CharField(max_length=64, unique=True)
    tracking_token_encrypted = models.TextField()
    public_origin = models.URLField(max_length=500)
    requester_name = models.CharField(max_length=255, blank=True, default="")
    requester_email = models.EmailField(blank=True, default="")
    locale = models.CharField(max_length=16, default="ru")
    submitted_values = models.JSONField(default=dict)
    public_status = models.CharField(
        max_length=24,
        choices=IntakeFormPublicStatus.choices,
        default=IntakeFormPublicStatus.RECEIVED,
    )
    email_notifications_enabled = models.BooleanField(default=False)
    idempotency_key = models.CharField(max_length=128, null=True, blank=True)

    class Meta:
        verbose_name = "Intake Form Submission"
        verbose_name_plural = "Intake Form Submissions"
        db_table = "intake_form_submissions"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["form", "idempotency_key"],
                condition=Q(idempotency_key__isnull=False, deleted_at__isnull=True),
                name="unique_intake_form_submission_idempotency_key",
            )
        ]


class IntakeFormEvent(ProjectBaseModel):
    submission = models.ForeignKey(
        IntakeFormSubmission,
        on_delete=models.CASCADE,
        related_name="events",
    )
    event_type = models.CharField(max_length=32)
    public_status = models.CharField(
        max_length=24,
        choices=IntakeFormPublicStatus.choices,
        null=True,
        blank=True,
    )
    message = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Intake Form Event"
        verbose_name_plural = "Intake Form Events"
        db_table = "intake_form_events"
        ordering = ("created_at",)


@receiver(post_save, sender="db.Issue")
def schedule_intake_form_status_sync(sender, instance, **kwargs):
    submission_id = IntakeFormSubmission.objects.filter(
        intake_issue__issue_id=instance.id,
        deleted_at__isnull=True,
    ).values_list("id", flat=True).first()
    if not submission_id:
        return
    from plane.bgtasks.intake_form_task import sync_intake_form_submission_status

    transaction.on_commit(lambda: sync_intake_form_submission_status.delay(str(submission_id)))


@receiver(post_save, sender="db.IssueComment")
def notify_requester_about_public_team_comment(sender, instance, created, **kwargs):
    if not created or instance.access != "EXTERNAL" or not instance.actor_id:
        return
    submission = IntakeFormSubmission.objects.filter(
        intake_issue__issue_id=instance.issue_id,
        deleted_at__isnull=True,
    ).first()
    if not submission:
        return
    IntakeFormEvent.objects.create(
        workspace=submission.workspace,
        project=submission.project,
        submission=submission,
        event_type="TEAM_COMMENTED",
    )
    from plane.bgtasks.intake_form_task import send_intake_form_requester_email

    transaction.on_commit(
        lambda: send_intake_form_requester_email.delay(str(submission.id), "TEAM_COMMENTED")
    )
