# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import User
from plane.license.models import InstanceAdmin
from .base import BaseSerializer
from .user import UserLiteSerializer


class InstanceUserSerializer(BaseSerializer):
    blocked_by = UserLiteSerializer(read_only=True)
    status = serializers.SerializerMethodField()
    is_instance_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "display_name",
            "first_name",
            "last_name",
            "avatar_url",
            "date_joined",
            "last_login_time",
            "is_active",
            "status",
            "is_instance_admin",
            "blocked_at",
            "blocked_reason",
            "blocked_by",
        ]
        read_only_fields = fields

    def get_status(self, obj):
        if obj.blocked_at is not None:
            return "blocked"
        if obj.is_active:
            return "active"
        return "inactive"

    def get_is_instance_admin(self, obj):
        if hasattr(obj, "is_instance_admin"):
            return obj.is_instance_admin
        return InstanceAdmin.objects.filter(user=obj).exists()
