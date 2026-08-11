# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models


def normalize_user_names(apps, schema_editor):
    User = apps.get_model("db", "User")
    pending = []

    for user in User.objects.all().iterator(chunk_size=500):
        first_name = (user.first_name or "").strip()
        last_name = (user.last_name or "").strip()
        previous_display_name = (user.display_name or "").strip()

        if not first_name and not last_name:
            first_name = previous_display_name
            if not first_name and user.email:
                first_name = user.email.split("@", 1)[0]

        canonical_name = " ".join(part for part in (first_name, last_name) if part)
        user.first_name = first_name
        user.last_name = last_name
        user.legacy_display_name = (
            previous_display_name
            if previous_display_name and previous_display_name.casefold() != canonical_name.casefold()
            else ""
        )
        user.display_name = canonical_name or previous_display_name
        pending.append(user)

        if len(pending) >= 500:
            User.objects.bulk_update(
                pending,
                ["first_name", "last_name", "display_name", "legacy_display_name"],
                batch_size=500,
            )
            pending = []

    if pending:
        User.objects.bulk_update(
            pending,
            ["first_name", "last_name", "display_name", "legacy_display_name"],
            batch_size=500,
        )


def restore_legacy_display_names(apps, schema_editor):
    User = apps.get_model("db", "User")
    pending = []

    for user in User.objects.exclude(legacy_display_name="").iterator(chunk_size=500):
        user.display_name = user.legacy_display_name
        pending.append(user)
        if len(pending) >= 500:
            User.objects.bulk_update(pending, ["display_name"], batch_size=500)
            pending = []

    if pending:
        User.objects.bulk_update(pending, ["display_name"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0134_intake_form_attachments_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="legacy_display_name",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.RunPython(normalize_user_names, restore_legacy_display_names),
    ]
