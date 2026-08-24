from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [("db", "0143_project_announcements")]

    operations = [
        migrations.AddField(
            model_name="calendarconnection",
            name="is_gts_target",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="calendarconnection",
            name="gts_calendar_id",
            field=models.CharField(blank=True, default="", max_length=512),
        ),
        migrations.AddField(
            model_name="calendarconnection",
            name="gts_calendar_last_error",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddConstraint(
            model_name="calendarconnection",
            constraint=models.UniqueConstraint(
                fields=("user",),
                condition=Q(is_gts_target=True, deleted_at__isnull=True),
                name="unique_active_user_gts_calendar_target",
            ),
        ),
    ]
