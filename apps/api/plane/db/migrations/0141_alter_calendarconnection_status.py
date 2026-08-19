from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0140_calendar_preference_working_hours")]

    operations = [
        migrations.AlterField(
            model_name="calendarconnection",
            name="status",
            field=models.CharField(
                choices=[
                    ("CONNECTED", "Connected"),
                    ("PARTIAL", "Partially synchronized"),
                    ("PAUSED", "Paused"),
                    ("ERROR", "Error"),
                ],
                default="CONNECTED",
                max_length=16,
            ),
        ),
    ]
