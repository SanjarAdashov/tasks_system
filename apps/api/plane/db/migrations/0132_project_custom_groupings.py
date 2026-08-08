# Generated manually for project-scoped custom grouping layouts.

import django.db.models.deletion
import django.db.models.functions.text
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0131_project_user_groups"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectCustomGrouping",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("group_by", models.CharField(max_length=96)),
                ("date_bucket", models.CharField(blank=True, choices=[("EXACT", "Exact date"), ("DAY", "Day"), ("WEEK", "Week"), ("MONTH", "Month")], max_length=16, null=True)),
                ("access", models.CharField(choices=[("PERSONAL", "Personal"), ("PROJECT", "Project")], default="PERSONAL", max_length=16)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("owned_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_custom_groupings", to=settings.AUTH_USER_MODEL)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_groupings", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_groupings", to="db.workspace")),
            ],
            options={"verbose_name": "Project Custom Grouping", "verbose_name_plural": "Project Custom Groupings", "db_table": "project_custom_groupings", "ordering": ("access", "name", "created_at")},
        ),
        migrations.CreateModel(
            name="ProjectCustomGroupingPreference",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("collapsed_groups", models.JSONField(default=dict)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("active_grouping", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="active_preferences", to="db.projectcustomgrouping")),
                ("member", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_grouping_preferences", to=settings.AUTH_USER_MODEL)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_grouping_preferences", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_grouping_preferences", to="db.workspace")),
            ],
            options={"verbose_name": "Project Custom Grouping Preference", "verbose_name_plural": "Project Custom Grouping Preferences", "db_table": "project_custom_grouping_preferences"},
        ),
        migrations.AddConstraint(
            model_name="projectcustomgrouping",
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower("name"), models.F("project"), models.F("owned_by"), condition=models.Q(("access", "PERSONAL"), ("deleted_at__isnull", True)), name="unique_personal_custom_grouping_name"),
        ),
        migrations.AddConstraint(
            model_name="projectcustomgrouping",
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower("name"), models.F("project"), condition=models.Q(("access", "PROJECT"), ("deleted_at__isnull", True)), name="unique_project_custom_grouping_name"),
        ),
        migrations.AddConstraint(
            model_name="projectcustomgroupingpreference",
            constraint=models.UniqueConstraint(condition=models.Q(("deleted_at__isnull", True)), fields=("project", "member"), name="unique_project_custom_grouping_preference"),
        ),
    ]
