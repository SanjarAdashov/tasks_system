# Generated manually to make attachments configurable on public Intake forms.

from django.db import migrations


ATTACHMENTS_FIELD = {
    "id": "attachments",
    "source": "FORM",
    "key": "attachments",
    "visible": True,
    "required": False,
}


def add_attachments_field(apps, schema_editor):
    IntakeForm = apps.get_model("db", "IntakeForm")
    for form in IntakeForm.objects.all().iterator():
        fields = list(form.field_schema or [])
        if any(field.get("key") == "attachments" for field in fields):
            continue
        max_sort_order = max(
            (int(field.get("sort_order", 0)) for field in fields),
            default=0,
        )
        fields.append({**ATTACHMENTS_FIELD, "sort_order": max_sort_order + 1000})
        form.field_schema = fields
        form.save(update_fields=["field_schema"])


def remove_attachments_field(apps, schema_editor):
    IntakeForm = apps.get_model("db", "IntakeForm")
    for form in IntakeForm.objects.all().iterator():
        fields = [field for field in (form.field_schema or []) if field.get("key") != "attachments"]
        if len(fields) == len(form.field_schema or []):
            continue
        form.field_schema = fields
        form.save(update_fields=["field_schema"])


class Migration(migrations.Migration):
    dependencies = [("db", "0133_intake_public_forms")]

    operations = [
        migrations.RunPython(add_attachments_field, remove_attachments_field),
    ]
