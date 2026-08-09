# Generated manually for project-scoped public Intake forms.

import django.db.models.deletion
import django.db.models.functions.text
import uuid
from django.conf import settings
from django.db import migrations, models

import plane.db.models.intake_form


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0132_project_custom_groupings"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="IntakeForm",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("slug", models.SlugField(max_length=120)),
                ("description", models.TextField(blank=True, default="")),
                ("is_enabled", models.BooleanField(default=True)),
                ("archived_at", models.DateTimeField(blank=True, null=True)),
                ("access_type", models.CharField(choices=[("PUBLIC", "Public"), ("CODE", "Access code"), ("AUTHENTICATED", "Workspace users")], default="PUBLIC", max_length=24)),
                ("access_code_hash", models.CharField(blank=True, default="", max_length=255)),
                ("field_schema", models.JSONField(default=plane.db.models.intake_form.get_default_intake_form_fields)),
                ("hidden_values", models.JSONField(blank=True, default=dict)),
                ("conditions", models.JSONField(blank=True, default=list)),
                ("branding", models.JSONField(blank=True, default=dict)),
                ("translations", models.JSONField(blank=True, default=dict)),
                ("public_status_mapping", models.JSONField(default=plane.db.models.intake_form.get_default_public_status_mapping)),
                ("title_template", models.CharField(default="Request from {requester_name}: {short_description}", max_length=500)),
                ("email_notifications_enabled", models.BooleanField(default=False)),
                ("max_attachments", models.PositiveSmallIntegerField(default=20)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("intake", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="forms", to="db.intake")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_%(class)s", to="db.project")),
                ("reviewer_group", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="intake_forms", to="db.projectusergroup")),
                ("target_state", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="intake_forms", to="db.state")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_%(class)s", to="db.workspace")),
            ],
            options={"verbose_name": "Intake Form", "verbose_name_plural": "Intake Forms", "db_table": "intake_forms", "ordering": ("name", "created_at")},
        ),
        migrations.CreateModel(
            name="IntakeFormSubmission",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("reference", models.CharField(max_length=32, unique=True)),
                ("tracking_token_hash", models.CharField(max_length=64, unique=True)),
                ("tracking_token_encrypted", models.TextField()),
                ("public_origin", models.URLField(max_length=500)),
                ("requester_name", models.CharField(blank=True, default="", max_length=255)),
                ("requester_email", models.EmailField(blank=True, default="", max_length=254)),
                ("locale", models.CharField(default="ru", max_length=16)),
                ("submitted_values", models.JSONField(default=dict)),
                ("public_status", models.CharField(choices=[("RECEIVED", "Received"), ("UNDER_REVIEW", "Under review"), ("IN_PROGRESS", "In progress"), ("COMPLETED", "Completed"), ("REJECTED", "Rejected")], default="RECEIVED", max_length=24)),
                ("email_notifications_enabled", models.BooleanField(default=False)),
                ("idempotency_key", models.CharField(blank=True, max_length=128, null=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("form", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="submissions", to="db.intakeform")),
                ("intake_issue", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="form_submission", to="db.intakeissue")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_%(class)s", to="db.project")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_%(class)s", to="db.workspace")),
            ],
            options={"verbose_name": "Intake Form Submission", "verbose_name_plural": "Intake Form Submissions", "db_table": "intake_form_submissions", "ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="IntakeFormEvent",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("event_type", models.CharField(max_length=32)),
                ("public_status", models.CharField(blank=True, choices=[("RECEIVED", "Received"), ("UNDER_REVIEW", "Under review"), ("IN_PROGRESS", "In progress"), ("COMPLETED", "Completed"), ("REJECTED", "Rejected")], max_length=24, null=True)),
                ("message", models.TextField(blank=True, default="")),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_%(class)s", to="db.project")),
                ("submission", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="events", to="db.intakeformsubmission")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_%(class)s", to="db.workspace")),
            ],
            options={"verbose_name": "Intake Form Event", "verbose_name_plural": "Intake Form Events", "db_table": "intake_form_events", "ordering": ("created_at",)},
        ),
        migrations.AddConstraint(model_name="intakeform", constraint=models.UniqueConstraint(django.db.models.functions.text.Lower("slug"), condition=models.Q(("deleted_at__isnull", True)), name="unique_active_intake_form_slug")),
        migrations.AddConstraint(model_name="intakeform", constraint=models.CheckConstraint(condition=models.Q(("max_attachments__gte", 1), ("max_attachments__lte", 20)), name="intake_form_max_attachments_between_1_and_20")),
        migrations.AddConstraint(model_name="intakeformsubmission", constraint=models.UniqueConstraint(condition=models.Q(("deleted_at__isnull", True), ("idempotency_key__isnull", False)), fields=("form", "idempotency_key"), name="unique_intake_form_submission_idempotency_key")),
    ]
