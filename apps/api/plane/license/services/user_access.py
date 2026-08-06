# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import transaction
from django.utils import timezone

# Module imports
from plane.db.models import APIToken, Session, User, UserAccessLog
from plane.license.models import Instance, InstanceAdmin


MAX_REASON_LENGTH = 2000


class UserAccessError(Exception):
    def __init__(self, code, message, status_code=400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _validate_reason(reason, *, required):
    if reason is None:
        reason = ""
    if not isinstance(reason, str):
        raise UserAccessError(
            "INVALID_REASON",
            "Reason must be a string.",
        )

    reason = reason.strip()
    if required and not reason:
        raise UserAccessError(
            "BLOCK_REASON_REQUIRED",
            "A reason is required to block a user.",
        )
    if len(reason) > MAX_REASON_LENGTH:
        raise UserAccessError(
            "REASON_TOO_LONG",
            f"Reason cannot exceed {MAX_REASON_LENGTH} characters.",
        )
    return reason


def _get_locked_user(user_id):
    try:
        return User.objects.select_for_update().get(pk=user_id, is_bot=False)
    except User.DoesNotExist as exc:
        raise UserAccessError(
            "USER_NOT_FOUND",
            "The user does not exist.",
            status_code=404,
        ) from exc


@transaction.atomic
def block_user(*, user_id, actor, reason):
    reason = _validate_reason(reason, required=True)
    user = _get_locked_user(user_id)

    if user.id == actor.id:
        raise UserAccessError(
            "CANNOT_BLOCK_SELF",
            "You cannot block your own account.",
        )

    if user.blocked_at is not None:
        raise UserAccessError(
            "USER_ALREADY_BLOCKED",
            "The user is already blocked.",
            status_code=409,
        )

    if not user.is_active:
        raise UserAccessError(
            "USER_NOT_ACTIVE",
            "Only an active account can be blocked.",
            status_code=409,
        )

    instance = Instance.objects.select_for_update().first()
    if instance and InstanceAdmin.objects.filter(instance=instance, user=user).exists():
        another_active_admin_exists = (
            InstanceAdmin.objects.filter(
                instance=instance,
                user__is_active=True,
                user__blocked_at__isnull=True,
            )
            .exclude(user=user)
            .exists()
        )
        if not another_active_admin_exists:
            raise UserAccessError(
                "CANNOT_BLOCK_LAST_INSTANCE_ADMIN",
                "The last active instance administrator cannot be blocked.",
            )

    blocked_at = timezone.now()
    user.is_active = False
    user.blocked_at = blocked_at
    user.blocked_by = actor
    user.blocked_reason = reason
    user.last_logout_time = blocked_at
    user.save(
        update_fields=[
            "is_active",
            "blocked_at",
            "blocked_by",
            "blocked_reason",
            "last_logout_time",
            "updated_at",
        ]
    )

    # Existing sessions and personal API keys must not become valid again when
    # the account is later unblocked.
    Session.objects.filter(user_id=str(user.id)).delete()
    APIToken.objects.filter(user=user, is_active=True).update(
        is_active=False,
        updated_at=blocked_at,
    )

    UserAccessLog.objects.create(
        user=user,
        actor=actor,
        action=UserAccessLog.Action.BLOCKED,
        reason=reason,
    )
    return user


@transaction.atomic
def unblock_user(*, user_id, actor, reason=""):
    reason = _validate_reason(reason, required=False)
    user = _get_locked_user(user_id)

    if user.blocked_at is None:
        raise UserAccessError(
            "USER_NOT_BLOCKED",
            "The user is not blocked.",
            status_code=409,
        )

    user.is_active = True
    user.blocked_at = None
    user.blocked_by = None
    user.blocked_reason = None
    user.save(
        update_fields=[
            "is_active",
            "blocked_at",
            "blocked_by",
            "blocked_reason",
            "updated_at",
        ]
    )

    UserAccessLog.objects.create(
        user=user,
        actor=actor,
        action=UserAccessLog.Action.UNBLOCKED,
        reason=reason,
    )
    return user
