# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import hashlib
import re
import secrets
import string

from django.utils.text import slugify

from plane.db.models import IntakeForm, ProjectMember, ProjectUserGroupMember


CYRILLIC_TRANSLITERATION = str.maketrans(
    {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        "ў": "o", "қ": "q", "ғ": "g", "ҳ": "h",
    }
)


def normalize_intake_form_slug(value):
    value = (value or "").strip().lower().translate(CYRILLIC_TRANSLITERATION)
    value = slugify(value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:120]


def suggest_intake_form_slugs(value, *, exclude_id=None, count=3):
    base = normalize_intake_form_slug(value) or "support-form"
    queryset = IntakeForm.objects.filter(deleted_at__isnull=True)
    if exclude_id:
        queryset = queryset.exclude(id=exclude_id)
    suggestions = []
    candidate = base
    suffix = 1
    while len(suggestions) < count:
        if not queryset.filter(slug__iexact=candidate).exists():
            suggestions.append(candidate)
        suffix += 1
        candidate = f"{base[: max(1, 120 - len(str(suffix)) - 1)]}-{suffix}"
    return suggestions


def generate_access_code(length=10):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_tracking_token():
    return secrets.token_urlsafe(40)


def hash_tracking_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_submission_reference():
    return f"SUP-{secrets.token_hex(5).upper()}"


def is_condition_rule_matched(rule, values):
    actual = values.get(str(rule.get("field_id", "")))
    expected = rule.get("value")
    operator = rule.get("operator", "EQUALS")
    if operator == "IS_EMPTY":
        return actual in (None, "", [])
    if operator == "IS_NOT_EMPTY":
        return actual not in (None, "", [])
    if operator == "NOT_EQUALS":
        return actual != expected
    if operator == "CONTAINS":
        return expected in actual if isinstance(actual, (str, list)) else False
    return actual == expected


def get_visible_intake_form_field_ids(form, values):
    visible_ids = {
        str(field["id"])
        for field in form.field_schema
        if field.get("visible", True)
    }
    for condition in form.conditions:
        target_id = str(condition.get("target_field_id", ""))
        rules = condition.get("rules", [])
        matcher = all if condition.get("match", "ALL") == "ALL" else any
        matched = matcher(is_condition_rule_matched(rule, values) for rule in rules) if rules else True
        if condition.get("action", "SHOW") == "SHOW":
            if matched:
                visible_ids.add(target_id)
            else:
                visible_ids.discard(target_id)
        elif matched:
            visible_ids.discard(target_id)
    return visible_ids


def render_intake_form_title(form, values):
    title = str(values.get("title") or "").strip()
    if title:
        return title[:255]
    description = str(values.get("description") or "").strip()
    context = {
        "requester_name": str(values.get("requester_name") or "Anonymous").strip(),
        "requester_email": str(values.get("requester_email") or "").strip(),
        "short_description": description[:100] or "New request",
    }
    try:
        rendered = form.title_template.format_map(context).strip()
    except (KeyError, ValueError):
        rendered = f"Request from {context['requester_name']}: {context['short_description']}"
    return rendered[:255]


def can_review_intake_form_submission(user, intake_issue):
    if user is None or user.is_anonymous:
        return False
    if ProjectMember.objects.filter(
        project=intake_issue.project,
        member=user,
        role=20,
        is_active=True,
    ).exists():
        return True
    submission = getattr(intake_issue, "form_submission", None)
    if not submission or not submission.form.reviewer_group_id:
        return False
    return ProjectUserGroupMember.objects.filter(
        group_id=submission.form.reviewer_group_id,
        member=user,
        project=intake_issue.project,
        deleted_at__isnull=True,
        group__archived_at__isnull=True,
        member__is_active=True,
        member__blocked_at__isnull=True,
        member__member_project__project=intake_issue.project,
        member__member_project__is_active=True,
    ).exists()
