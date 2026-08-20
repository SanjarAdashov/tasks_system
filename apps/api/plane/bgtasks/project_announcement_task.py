# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import html
import logging

from celery import shared_task
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db.models import Case, IntegerField, Q, When

from plane.db.models import (
    ProjectAnnouncement,
    ProjectAnnouncementRecipient,
    UserNotificationPreference,
)
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.telegram import application_url, enqueue_telegram_notifications


LOGGER = logging.getLogger("plane.worker")

COPY = {
    "en": {
        "standard": "Project notification",
        "important": "Important project notification",
        "open": "Open notification",
        "files": "Attachments",
    },
    "ru": {
        "standard": "Уведомление проекта",
        "important": "Важное уведомление проекта",
        "open": "Открыть уведомление",
        "files": "Вложения",
    },
    "uz": {
        "standard": "Loyiha bildirishnomasi",
        "important": "Muhim loyiha bildirishnomasi",
        "open": "Bildirishnomani ochish",
        "files": "Ilovalar",
    },
}


def _language(user):
    value = (getattr(getattr(user, "profile", None), "language", "") or "en").lower()
    return "uz" if value.startswith("uz") else "ru" if value.startswith("ru") else "en"


def _email_preference_enabled(recipient):
    preference = (
        UserNotificationPreference.objects.filter(user=recipient.user)
        .filter(
            Q(project=recipient.project)
            | Q(project__isnull=True, workspace=recipient.workspace)
            | Q(project__isnull=True, workspace__isnull=True)
        )
        .annotate(
            specificity=Case(
                When(project=recipient.project, then=3),
                When(workspace=recipient.workspace, then=2),
                default=1,
                output_field=IntegerField(),
            )
        )
        .order_by("-specificity", "-created_at")
        .first()
    )
    return True if preference is None else preference.project_announcement


def _smtp_connection():
    host, user, password, port, use_tls, use_ssl, sender = get_email_configuration()
    if not host:
        return None, sender
    return (
        get_connection(
            host=host,
            port=int(port),
            username=user,
            password=password,
            use_tls=use_tls == "1",
            use_ssl=use_ssl == "1",
        ),
        sender,
    )


def _send_email(recipient):
    if not _email_preference_enabled(recipient) or not recipient.user.email:
        return ProjectAnnouncementRecipient.DeliveryStatus.SKIPPED, ""
    connection, sender = _smtp_connection()
    if connection is None:
        return ProjectAnnouncementRecipient.DeliveryStatus.SKIPPED, "Email is not configured."

    announcement = recipient.announcement
    language = _language(recipient.user)
    copy = COPY[language]
    notification_url = application_url(f"{announcement.workspace.slug}/notifications/announcements/{announcement.id}")
    attachment_rows = list(announcement.attachments.all())
    attachments_html = ""
    attachments_text = ""
    if attachment_rows:
        links = []
        text_links = []
        for attachment in attachment_rows:
            name = attachment.asset.attributes.get("name") or "attachment"
            url = application_url(
                f"api/workspaces/{announcement.workspace.slug}/project-announcements/"
                f"{announcement.id}/attachments/{attachment.id}/?disposition=attachment"
            )
            links.append(f'<li><a href="{html.escape(url)}">{html.escape(name)}</a></li>')
            text_links.append(f"- {name}: {url}")
        attachments_html = f'<h3 style="margin:24px 0 8px">{copy["files"]}</h3><ul>{"".join(links)}</ul>'
        attachments_text = f"\n\n{copy['files']}:\n" + "\n".join(text_links)

    heading = copy[announcement.announcement_type]
    subject = f"{heading}: {announcement.title}"
    html_body = (
        f'<!doctype html><html lang="{language}"><body style="margin:0;background:#f4f5f7;'
        'color:#172b4d;font-family:Arial,sans-serif"><table role="presentation" width="100%" '
        'cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="620" cellspacing="0" cellpadding="0" '
        'style="max-width:620px;background:#fff;border:1px solid #dfe1e6;border-radius:16px">'
        '<tr><td style="padding:24px 30px;border-bottom:1px solid #ebecf0">'
        '<strong style="font-size:18px">GTS Tasks System</strong></td></tr>'
        '<tr><td style="padding:30px"><div style="font-size:13px;color:#6b778c">'
        f"{html.escape(heading)} · {html.escape(announcement.project.name)}</div>"
        f'<h1 style="margin:8px 0 22px;font-size:26px">{html.escape(announcement.title)}</h1>'
        f'<div style="font-size:15px;line-height:1.6">{announcement.content_html}</div>'
        f'{attachments_html}<p style="margin-top:28px"><a href="{html.escape(notification_url)}" '
        'style="display:inline-block;background:#0077b6;color:#fff;text-decoration:none;padding:12px 18px;'
        f'border-radius:8px;font-weight:700">{copy["open"]}</a></p>'
        "</td></tr></table></td></tr></table></body></html>"
    )
    text_body = (
        f"GTS Tasks System — {heading}\n{announcement.project.name}\n\n"
        f"{announcement.title}\n\n{announcement.content_plain}{attachments_text}\n\n{notification_url}"
    )
    try:
        message = EmailMultiAlternatives(
            subject,
            text_body,
            sender,
            [recipient.user.email],
            connection=connection,
        )
        message.attach_alternative(html_body, "text/html")
        message.send(fail_silently=False)
    except Exception as exc:
        LOGGER.exception(
            "Failed to send project announcement email",
            extra={"announcement_id": str(announcement.id), "recipient_id": str(recipient.id)},
        )
        return ProjectAnnouncementRecipient.DeliveryStatus.FAILED, str(exc)[:1000]
    return ProjectAnnouncementRecipient.DeliveryStatus.SENT, ""


@shared_task
def dispatch_project_announcement(announcement_id):
    announcement = (
        ProjectAnnouncement.objects.filter(pk=announcement_id)
        .select_related("project", "workspace", "created_by")
        .prefetch_related("attachments__asset", "recipients__user__profile", "recipients__notification")
        .first()
    )
    if not announcement:
        return
    recipients = list(announcement.recipients.all())
    for recipient in recipients:
        email_status, email_error = _send_email(recipient)
        ProjectAnnouncementRecipient.objects.filter(pk=recipient.pk).update(
            email_status=email_status,
            email_error=email_error,
        )

    notifications = [recipient.notification for recipient in recipients if recipient.notification_id]
    deliveries = enqueue_telegram_notifications(notifications)
    delivery_by_notification = {delivery.notification_id: delivery for delivery in deliveries}
    for recipient in recipients:
        delivery = delivery_by_notification.get(recipient.notification_id)
        ProjectAnnouncementRecipient.objects.filter(pk=recipient.pk).update(
            telegram_status=(
                ProjectAnnouncementRecipient.DeliveryStatus.PENDING
                if delivery
                else ProjectAnnouncementRecipient.DeliveryStatus.SKIPPED
            )
        )
