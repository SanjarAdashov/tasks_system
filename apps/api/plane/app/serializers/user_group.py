# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import ProjectMember, ProjectUserGroup, ProjectUserGroupMember

from .base import BaseSerializer


class ProjectUserGroupMemberSerializer(BaseSerializer):
    member_id = serializers.UUIDField(read_only=True)
    display_name = serializers.CharField(source="member.display_name", read_only=True)
    legacy_display_name = serializers.CharField(source="member.legacy_display_name", read_only=True)
    first_name = serializers.CharField(source="member.first_name", read_only=True)
    last_name = serializers.CharField(source="member.last_name", read_only=True)
    email = serializers.CharField(source="member.email", read_only=True)
    avatar_url = serializers.CharField(source="member.avatar_url", read_only=True, allow_null=True)
    account_status = serializers.SerializerMethodField()
    project_member_active = serializers.SerializerMethodField()

    class Meta:
        model = ProjectUserGroupMember
        fields = [
            "id",
            "member_id",
            "display_name",
            "legacy_display_name",
            "first_name",
            "last_name",
            "email",
            "avatar_url",
            "account_status",
            "project_member_active",
        ]
        read_only_fields = fields

    def get_account_status(self, obj):
        if obj.member.blocked_at is not None:
            return "blocked"
        return "active" if obj.member.is_active else "inactive"

    def get_project_member_active(self, obj):
        return ProjectMember.objects.filter(
            project=obj.project,
            member=obj.member,
            is_active=True,
        ).exists()


class ProjectUserGroupSerializer(BaseSerializer):
    members = ProjectUserGroupMemberSerializer(source="memberships", many=True, read_only=True)
    member_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
        default=list,
    )

    class Meta:
        model = ProjectUserGroup
        fields = [
            "id",
            "name",
            "description",
            "archived_at",
            "members",
            "member_ids",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "archived_at", "members", "created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Group name is required.")
        return value

    def validate_member_ids(self, value):
        project = self.context["project"]
        unique_ids = list(dict.fromkeys(value))
        eligible = ProjectMember.objects.filter(
            project=project,
            member_id__in=unique_ids,
            is_active=True,
            member__is_active=True,
            member__blocked_at__isnull=True,
        ).values_list("member_id", flat=True)
        if set(eligible) != set(unique_ids):
            raise serializers.ValidationError("All added users must be active project members.")
        return unique_ids

    def create(self, validated_data):
        member_ids = validated_data.pop("member_ids", [])
        group = super().create(validated_data)
        ProjectUserGroupMember.objects.bulk_create(
            [
                ProjectUserGroupMember(
                    workspace=group.workspace,
                    project=group.project,
                    group=group,
                    member_id=member_id,
                )
                for member_id in member_ids
            ]
        )
        return group

    def update(self, instance, validated_data):
        validated_data.pop("member_ids", None)
        return super().update(instance, validated_data)
