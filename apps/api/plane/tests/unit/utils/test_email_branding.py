import re

import pytest
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from plane.license.utils import instance_value
from plane.utils.email import attach_inline_email_assets


TEMPLATE_CASES = [
    ("emails/auth/magic_signin.html", {"code": "482913", "email": "user@example.com"}),
    (
        "emails/auth/magic_signin.html",
        {"code": "482913", "email": "user@example.com", "email_update": True},
    ),
    (
        "emails/auth/forgot_password.html",
        {
            "first_name": "Alex",
            "email": "user@example.com",
            "forgot_password_url": "https://tasks.globaltravel.space/reset/example",
        },
    ),
    ("emails/exports/analytics.html", {}),
    (
        "emails/invitations/workspace_invitation.html",
        {
            "first_name": "Alex",
            "workspace_name": "Operations",
            "email": "user@example.com",
            "abs_url": "https://tasks.globaltravel.space/invite/example",
        },
    ),
    (
        "emails/invitations/project_invitation.html",
        {
            "first_name": "Alex",
            "project_name": "Support",
            "email": "user@example.com",
            "invitation_url": "https://tasks.globaltravel.space/project-invitations/example",
        },
    ),
    (
        "emails/notifications/project_addition.html",
        {
            "inviter_first_name": "Alex",
            "workspace_name": "Operations",
            "project_name": "Support",
            "email": "user@example.com",
            "project_url": "https://tasks.globaltravel.space/operations/projects/example/issues",
        },
    ),
    (
        "emails/user/user_activation.html",
        {
            "email": "user@example.com",
            "profile_url": "https://tasks.globaltravel.space/profile",
        },
    ),
    ("emails/user/user_deactivation.html", {"email": "user@example.com"}),
    ("emails/user/email_updated.html", {"email": "user@example.com"}),
    (
        "emails/notifications/webhook-deactivate.html",
        {
            "email": "user@example.com",
            "message": "A webhook was disabled after repeated failed requests.",
            "webhook_url": "https://tasks.globaltravel.space/settings/webhooks/example",
        },
    ),
    ("emails/test_email.html", {}),
    (
        "emails/notifications/issue-updates.html",
        {
            "actors_involved": 1,
            "summary": "Updates were made to the task by",
            "workspace": "operations",
            "project": "Support",
            "issue": {"issue_identifier": "SUP-42", "name": "Test task"},
            "issue_url": "https://tasks.globaltravel.space/operations/projects/support/issues/42",
            "user_preference": "https://tasks.globaltravel.space/operations/settings/account/notifications",
            "receiver": {"email": "user@example.com"},
            "data": [
                {
                    "actor_detail": {"first_name": "Alex", "last_name": "Smith"},
                    "activity_time": "10:30 AM",
                    "changes": {
                        "target_date": {"old_value": ["2026-08-14"], "new_value": ["2026-08-15"]},
                        "duplicate": {"old_value": [], "new_value": ["SUP-12"]},
                        "assignees": {"old_value": ["Pat"], "new_value": ["Sam"]},
                        "labels": {"old_value": [], "new_value": ["Backend"]},
                        "state": {"old_value": ["Todo"], "new_value": ["In Progress"]},
                        "link": {
                            "old_value": [],
                            "new_value": ["https://tasks.globaltravel.space/operations/projects/support/issues/42"],
                        },
                        "priority": {"old_value": ["low"], "new_value": ["high"]},
                        "blocking": {"old_value": [], "new_value": ["SUP-51"]},
                    },
                }
            ],
            "comments": [],
        },
    ),
]


@pytest.mark.parametrize(("template_name", "context"), TEMPLATE_CASES)
def test_email_template_branding_is_local_and_gts_only(template_name, context):
    html_content = render_to_string(template_name, context)
    lowered_html = html_content.lower()

    assert "gts tasks system" in lowered_html
    assert not re.search(r"\bplane\b", lowered_html)
    assert "plane.so" not in lowered_html
    assert "makeplane" not in lowered_html
    assert "planepowers" not in lowered_html
    assert not re.search(r"<img[^>]+src=[\"']https?://", html_content, flags=re.IGNORECASE)

    message = EmailMultiAlternatives(subject="Test", body="Test", to=["user@example.com"])
    message.attach_alternative(html_content, "text/html")
    attach_inline_email_assets(message, html_content)

    referenced_content_ids = set(re.findall(r"cid:([a-z0-9-]+)", html_content, flags=re.IGNORECASE))
    attached_content_ids = {
        str(attachment["Content-ID"]).strip("<>")
        for attachment in message.attachments
        if attachment.get_content_maintype() == "image"
    }
    assert referenced_content_ids == attached_content_ids


def test_empty_email_sender_uses_gts_default(monkeypatch):
    monkeypatch.setattr(
        instance_value,
        "get_configuration_value",
        lambda _: ("smtp.example.com", "user", "password", 587, "1", "0", ""),
    )

    assert instance_value.get_email_configuration()[-1] == "GTS Tasks System <tasks@globaltravel.space>"
