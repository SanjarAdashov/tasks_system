# Generated manually for project-scoped user groups.

import django.db.models.deletion
import django.db.models.functions.text
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0130_creation_quotas"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ProjectUserGroup",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                ("archived_at", models.DateTimeField(blank=True, null=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="user_groups", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_user_groups", to="db.workspace")),
            ],
            options={"verbose_name": "Project User Group", "verbose_name_plural": "Project User Groups", "db_table": "project_user_groups", "ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="ProjectUserGroupMember",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="db.projectusergroup")),
                ("member", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_user_group_memberships", to=settings.AUTH_USER_MODEL)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="user_group_memberships", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_user_group_memberships", to="db.workspace")),
            ],
            options={"verbose_name": "Project User Group Member", "verbose_name_plural": "Project User Group Members", "db_table": "project_user_group_members"},
        ),
        migrations.AddConstraint(
            model_name="projectusergroup",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("name"),
                models.F("project"),
                condition=models.Q(("archived_at__isnull", True), ("deleted_at__isnull", True)),
                name="unique_active_project_user_group_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="projectusergroupmember",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("group", "member"),
                name="unique_active_project_user_group_member",
            ),
        ),
    ]
