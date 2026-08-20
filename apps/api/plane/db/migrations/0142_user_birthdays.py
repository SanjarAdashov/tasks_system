from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


DEFAULT_TEMPLATES = {
    "BIRTHDAY_GREETING_TEMPLATE_RU": "С днём рождения, {name}! Желаем вдохновения, ярких идей и отличного года впереди!",
    "BIRTHDAY_GREETING_TEMPLATE_UZ": "Tug‘ilgan kuningiz bilan, {name}! Sizga ilhom, yorqin g‘oyalar va ajoyib yil tilaymiz!",
    "BIRTHDAY_GREETING_TEMPLATE_EN": "Happy birthday, {name}! Wishing you inspiration, bright ideas, and a wonderful year ahead!",
}


def create_birthday_configurations(apps, schema_editor):
    InstanceConfiguration = apps.get_model("license", "InstanceConfiguration")
    for key, value in DEFAULT_TEMPLATES.items():
        InstanceConfiguration.objects.get_or_create(
            key=key,
            defaults={"value": value, "category": "BIRTHDAY", "is_encrypted": False},
        )


def remove_birthday_configurations(apps, schema_editor):
    InstanceConfiguration = apps.get_model("license", "InstanceConfiguration")
    InstanceConfiguration.objects.filter(key__in=DEFAULT_TEMPLATES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0141_alter_calendarconnection_status"),
        ("license", "0006_instance_is_current_version_deprecated"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="birthday_greeting_seen_on",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="date_of_birth",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="BirthdayNotificationDelivery",
            fields=[
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Created At"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Last Modified At"),
                ),
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("occurrence_year", models.PositiveSmallIntegerField()),
                (
                    "delivery_type",
                    models.CharField(
                        choices=[
                            ("ADVANCE_IN_APP", "Advance in-app notification"),
                            ("ADVANCE_EMAIL", "Advance email notification"),
                            ("ADVANCE_TELEGRAM", "Advance Telegram notification"),
                            ("SELF_EMAIL", "Birthday email greeting"),
                            ("SELF_TELEGRAM", "Birthday Telegram greeting"),
                        ],
                        max_length=32,
                    ),
                ),
                ("delivered_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "birthday_user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="birthday_notifications_about",
                        to="db.user",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="birthday_notifications_received",
                        to="db.user",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
            ],
            options={"db_table": "birthday_notification_deliveries"},
        ),
        migrations.AddConstraint(
            model_name="birthdaynotificationdelivery",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deleted_at__isnull", True)),
                fields=("recipient", "birthday_user", "occurrence_year", "delivery_type"),
                name="unique_active_birthday_delivery",
            ),
        ),
        migrations.AddIndex(
            model_name="birthdaynotificationdelivery",
            index=models.Index(
                fields=["birthday_user", "occurrence_year"],
                name="bday_delivery_occurrence_idx",
            ),
        ),
        migrations.RunPython(create_birthday_configurations, remove_birthday_configurations),
    ]
