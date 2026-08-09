# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework.throttling import SimpleRateThrottle


class IntakeFormRateThrottle(SimpleRateThrottle):
    scope = "intake_form"

    def get_cache_key(self, request, view):
        identifier = view.kwargs.get("form_slug") or view.kwargs.get("tracking_token") or "unknown"
        return self.cache_format % {"scope": self.scope, "ident": f"{identifier}:{self.get_ident(request)}"}
