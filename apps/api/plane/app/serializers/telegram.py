# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import time

from rest_framework import serializers

from plane.db.models import TelegramNotificationPreference
from .base import BaseSerializer


class TelegramNotificationPreferenceSerializer(BaseSerializer):
    class Meta:
        model = TelegramNotificationPreference
        fields = [
            "enabled",
            "task_assignment",
            "mention",
            "comment",
            "state_change",
            "issue_completed",
            "priority",
            "due_date",
            "property_change",
            "role_change",
            "account_activity",
            "project_announcement",
            "quiet_hours_enabled",
            "quiet_hours",
        ]

    def validate_quiet_hours(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Quiet hours must be an object.")
        normalized = {}
        for day in range(1, 8):
            key = str(day)
            entry = value.get(key, {})
            if not isinstance(entry, dict):
                raise serializers.ValidationError(f"Day {day} must be an object.")
            enabled = bool(entry.get("enabled", False))
            start = entry.get("start", "22:00")
            end = entry.get("end", "08:00")
            try:
                time.fromisoformat(start)
                time.fromisoformat(end)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError(f"Invalid time for day {day}.") from exc
            normalized[key] = {"enabled": enabled, "start": start[:5], "end": end[:5]}
        return normalized
