import plane.db.models.calendar
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0139_calendar_notification_preferences")]

    operations = [
        migrations.AddField(
            model_name="calendarpreference",
            name="working_hours",
            field=models.JSONField(default=plane.db.models.calendar.get_default_working_hours),
        ),
    ]
