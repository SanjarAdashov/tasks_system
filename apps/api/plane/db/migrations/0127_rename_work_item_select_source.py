# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0126_work_item_multi_select_source"),
    ]

    operations = [
        migrations.RenameField(
            model_name="projectworkitemproperty",
            old_name="multi_select_source",
            new_name="select_source",
        ),
    ]
