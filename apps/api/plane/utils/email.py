# SPDX-FileCopyrightText: 2023-present Plane Software, Inc.
# SPDX-License-Identifier: LicenseRef-Plane-Commercial
#
# Licensed under the Plane Commercial License (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# https://plane.so/legals/eula
#
# DO NOT remove or modify this notice.
# NOTICE: Proprietary and confidential. Unauthorized use or distribution is prohibited.

# Python imports
from email.mime.image import MIMEImage
from pathlib import Path
import re

# Django imports
from django.utils.html import strip_tags


EMAIL_ASSET_ROOT = Path(__file__).with_name("email_assets")
INLINE_EMAIL_ASSETS = {
    "gts-logo-white": "gts-logo-white.png",
    "gts-logo-dark": "gts-logo-dark.png",
    "email-icon-assignee": "assignee.png",
    "email-icon-backlog": "backlog.png",
    "email-icon-blocking": "blocking.png",
    "email-icon-cancelled": "cancelled.png",
    "email-icon-done": "done.png",
    "email-icon-due-date": "due-date.png",
    "email-icon-duplicate": "duplicate.png",
    "email-icon-forward-arrow": "forward-arrow.png",
    "email-icon-in-progress": "in-progress.png",
    "email-icon-labels": "labels.png",
    "email-icon-link": "link.png",
    "email-icon-priority": "priority.png",
    "email-icon-state": "state.png",
    "email-icon-todo": "todo.png",
}


def attach_inline_email_assets(message, html_content):
    """Attach only the local CID images referenced by an HTML email."""
    content_ids = sorted(set(re.findall(r"cid:([a-z0-9-]+)", html_content, flags=re.IGNORECASE)))

    for content_id in content_ids:
        filename = INLINE_EMAIL_ASSETS.get(content_id)
        if filename is None:
            raise ValueError(f"Unknown inline email asset: {content_id}")

        asset_path = EMAIL_ASSET_ROOT / filename
        with asset_path.open("rb") as asset_file:
            image = MIMEImage(asset_file.read())
        image.add_header("Content-ID", f"<{content_id}>")
        image.add_header("Content-Disposition", "inline", filename=filename)
        message.attach(image)

    return message


def generate_plain_text_from_html(html_content):
    """
    Generate clean plain text from HTML email template.
    Removes all HTML tags, CSS styles, and excessive whitespace.

    Args:
        html_content (str): The HTML content to convert to plain text

    Returns:
        str: Clean plain text without HTML tags, styles, or excessive whitespace
    """
    # Remove style tags and their content
    html_content = re.sub(r"<style[^>]*>.*?</style>", "", html_content, flags=re.DOTALL | re.IGNORECASE)

    # Strip HTML tags
    text_content = strip_tags(html_content)

    # Remove excessive empty lines
    text_content = re.sub(r"\n\s*\n\s*\n+", "\n\n", text_content)

    # Ensure there's a leading and trailing whitespace
    text_content = "\n\n" + text_content.lstrip().rstrip() + "\n\n"

    return text_content
