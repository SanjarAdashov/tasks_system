# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from plane.db.models import TelegramDelivery, TelegramUserConnection
from plane.utils.telegram import TelegramAPIError, may_deliver, render_delivery, telegram_api_call


@shared_task
def deliver_telegram_delivery(delivery_id):
    with transaction.atomic():
        delivery = (
            TelegramDelivery.objects.select_for_update(of=("self",))
            .select_related("connection", "receiver", "receiver__profile")
            .filter(pk=delivery_id)
            .first()
        )
        if not delivery or delivery.status not in {
            TelegramDelivery.Status.PENDING,
            TelegramDelivery.Status.PROCESSING,
        }:
            return
        if delivery.available_at > timezone.now():
            return
        if delivery.connection.status == TelegramUserConnection.Status.PAUSED:
            delivery.status = TelegramDelivery.Status.PENDING
            delivery.available_at = timezone.now() + timedelta(minutes=5)
            delivery.save(update_fields=["status", "available_at", "updated_at"])
            return
        if delivery.connection.status != TelegramUserConnection.Status.CONNECTED or not may_deliver(delivery):
            delivery.status = TelegramDelivery.Status.CANCELLED
            delivery.save(update_fields=["status", "updated_at"])
            return
        delivery.status = TelegramDelivery.Status.PROCESSING
        delivery.attempts += 1
        delivery.save(update_fields=["status", "attempts", "updated_at"])

    try:
        result = telegram_api_call("sendMessage", render_delivery(delivery))
    except TelegramAPIError as exc:
        retryable = exc.error_code in {None, 429, 500, 502, 503, 504}
        with transaction.atomic():
            delivery = TelegramDelivery.objects.select_for_update().get(pk=delivery_id)
            delivery.last_error = str(exc)[:1000]
            if retryable and delivery.attempts < 8:
                delay = exc.retry_after or min(300, 2**delivery.attempts)
                delivery.status = TelegramDelivery.Status.PENDING
                delivery.available_at = timezone.now() + timedelta(seconds=delay)
            else:
                delivery.status = TelegramDelivery.Status.FAILED
                connection = delivery.connection
                connection.status = TelegramUserConnection.Status.ERROR
                connection.last_error = str(exc)[:1000]
                connection.last_error_at = timezone.now()
                connection.save(update_fields=["status", "last_error", "last_error_at", "updated_at"])
            delivery.save(update_fields=["status", "available_at", "last_error", "updated_at"])
        return

    now = timezone.now()
    TelegramDelivery.objects.filter(pk=delivery_id).update(
        status=TelegramDelivery.Status.SENT,
        sent_at=now,
        telegram_message_id=result.get("message_id"),
        last_error="",
    )
    TelegramUserConnection.objects.filter(pk=delivery.connection_id).update(
        last_delivery_at=now,
        last_error="",
        status=TelegramUserConnection.Status.CONNECTED,
    )


@shared_task
def process_due_telegram_deliveries():
    delivery_ids = list(
        TelegramDelivery.objects.filter(
            status=TelegramDelivery.Status.PENDING,
            available_at__lte=timezone.now(),
        )
        .order_by("created_at")
        .values_list("id", flat=True)[:500]
    )
    for delivery_id in delivery_ids:
        deliver_telegram_delivery.delay(str(delivery_id))
