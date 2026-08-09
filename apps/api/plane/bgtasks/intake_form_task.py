# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import logging
from html import escape

from celery import shared_task
from django.core.mail import EmailMultiAlternatives, get_connection

from plane.db.models import IntakeFormSubmission, Notification, ProjectUserGroupMember
from plane.license.utils.encryption import decrypt_data
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.exception_logger import log_exception


EMAIL_COPY = {
    "ru": {
        "SUBMITTED": "Заявка получена",
        "STATUS_CHANGED": "Статус заявки изменён",
        "TEAM_COMMENTED": "Новый ответ по заявке",
        "body": "Откройте страницу заявки, чтобы посмотреть актуальный статус и ответы команды.",
    },
    "uz": {
        "SUBMITTED": "So'rov qabul qilindi",
        "STATUS_CHANGED": "So'rov holati o'zgardi",
        "TEAM_COMMENTED": "So'rov bo'yicha yangi javob",
        "body": "Joriy holat va jamoa javoblarini ko'rish uchun so'rov sahifasini oching.",
    },
    "en": {
        "SUBMITTED": "Request received",
        "STATUS_CHANGED": "Request status changed",
        "TEAM_COMMENTED": "New reply to your request",
        "body": "Open the request page to see its current status and the team's replies.",
    },
}


def notify_intake_form_reviewers(submission, event_type, triggered_by=None):
    group_id = submission.form.reviewer_group_id
    if not group_id:
        return
    member_ids = ProjectUserGroupMember.objects.filter(
        group_id=group_id,
        project=submission.project,
        deleted_at__isnull=True,
        group__archived_at__isnull=True,
        member__is_active=True,
        member__blocked_at__isnull=True,
        member__member_project__project=submission.project,
        member__member_project__is_active=True,
    ).values_list("member_id", flat=True)
    Notification.objects.bulk_create(
        [
            Notification(
                workspace=submission.workspace,
                project=submission.project,
                data={
                    "intake_id": str(submission.intake_issue_id),
                    "reference": submission.reference,
                    "event_type": event_type,
                },
                entity_identifier=submission.intake_issue.issue_id,
                entity_name="issue",
                title=submission.intake_issue.issue.name,
                message={"event_type": event_type, "reference": submission.reference},
                message_html="<p>Public intake request update</p>",
                message_stripped="Public intake request update",
                sender="intake",
                triggered_by=triggered_by,
                receiver_id=member_id,
            )
            for member_id in set(member_ids)
        ]
    )


@shared_task
def send_intake_form_requester_email(submission_id, event_type):
    try:
        submission = IntakeFormSubmission.objects.select_related("form", "project").get(id=submission_id)
        if not submission.email_notifications_enabled or not submission.requester_email:
            return
        token = decrypt_data(submission.tracking_token_encrypted)
        if not token:
            return
        locale = submission.locale if submission.locale in EMAIL_COPY else "en"
        copy = EMAIL_COPY[locale]
        subject = f"{copy.get(event_type, copy['STATUS_CHANGED'])}: {submission.reference}"
        tracking_url = f"{submission.public_origin}/support/status/{token}"
        html_content = (
            f"<h2>{escape(subject)}</h2>"
            f"<p>{escape(copy['body'])}</p>"
            f"<p><a href=\"{escape(tracking_url)}\">{escape(tracking_url)}</a></p>"
        )
        (
            email_host,
            email_host_user,
            email_host_password,
            email_port,
            email_use_tls,
            email_use_ssl,
            email_from,
        ) = get_email_configuration()
        connection = get_connection(
            host=email_host,
            port=int(email_port),
            username=email_host_user,
            password=email_host_password,
            use_tls=email_use_tls == "1",
            use_ssl=email_use_ssl == "1",
        )
        message = EmailMultiAlternatives(
            subject=subject,
            body=f"{copy['body']} {tracking_url}",
            from_email=email_from,
            to=[submission.requester_email],
            connection=connection,
        )
        message.attach_alternative(html_content, "text/html")
        message.send()
        logging.getLogger("plane.worker").info("Intake form email sent.")
    except Exception as error:
        log_exception(error)


@shared_task
def sync_intake_form_submission_status(submission_id):
    try:
        submission = IntakeFormSubmission.objects.select_related(
            "form",
            "intake_issue__issue__state",
        ).get(id=submission_id)
        previous_status = submission.public_status
        from plane.space.serializer.intake_form import sync_public_submission_status

        sync_public_submission_status(submission)
        if submission.public_status != previous_status:
            send_intake_form_requester_email.delay(str(submission.id), "STATUS_CHANGED")
    except IntakeFormSubmission.DoesNotExist:
        return
    except Exception as error:
        log_exception(error)
