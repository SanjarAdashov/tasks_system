from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0138_calendar_meetings")]

    operations = [
        migrations.AddField(
            model_name="calendarpreference",
            name="email_notifications_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="calendarpreference",
            name="in_app_notifications_enabled",
            field=models.BooleanField(default=True),
        ),
    ]
