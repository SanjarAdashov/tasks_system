# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json
import re
from datetime import date
from uuid import UUID

# Django imports
from django.db.models import DateField, Exists, FloatField, OuterRef, Q
from django.db.models.expressions import RawSQL
from django.db.models.functions import Cast
from django.http import QueryDict

# Third party imports
from django_filters.utils import translate_validation
from rest_framework import filters
from rest_framework.exceptions import ValidationError as DRFValidationError

from plane.db.models import ProjectWorkItemProperty, WorkItemPropertyValue, WorkItemPropertyType
from plane.utils.exception_logger import log_exception


CUSTOM_PROPERTY_FILTER_PATTERN = re.compile(r"^customproperty_([0-9a-fA-F-]{36})__(exact|in|range|icontains|isnull)$")

CUSTOM_PROPERTY_LOOKUPS = {
    WorkItemPropertyType.SHORT_TEXT: {"exact", "icontains", "isnull"},
    WorkItemPropertyType.LONG_TEXT: {"exact", "icontains", "isnull"},
    WorkItemPropertyType.NUMBER: {"exact", "in", "range", "isnull"},
    WorkItemPropertyType.DATE: {"exact", "in", "range", "isnull"},
    WorkItemPropertyType.CHECKBOX: {"exact", "isnull"},
    WorkItemPropertyType.SINGLE_SELECT: {"exact", "in", "isnull"},
    WorkItemPropertyType.MULTI_SELECT: {"exact", "in", "isnull"},
}


class ComplexFilterBackend(filters.BaseFilterBackend):
    """
    Filter backend that supports complex JSON filtering.

    For full, up-to-date examples and usage, see the package README
    at `plane/utils/filters/README.md`.
    """

    filter_param = "filters"
    default_max_depth = 5

    def filter_queryset(self, request, queryset, view, filter_data=None):
        """Normalize filter input and apply JSON-based filtering.

        Accepts explicit `filter_data` (dict or JSON string) or reads the
        `filter` query parameter. Enforces JSON-only filtering.
        """
        try:
            if filter_data is not None:
                normalized = self._normalize_filter_data(filter_data, "filter_data")
                return self._apply_json_filter(queryset, normalized, view)

            filter_string = request.query_params.get(self.filter_param, None)
            if not filter_string:
                return queryset

            normalized = self._normalize_filter_data(filter_string, "filter")
            return self._apply_json_filter(queryset, normalized, view)
        except DRFValidationError:
            # Propagate validation errors unchanged
            raise
        except Exception as e:
            log_exception(e)
            raise

    def _normalize_filter_data(self, raw_filter, source_label):
        """Return a dict from raw filter input or raise a ValidationError.

        - raw_filter may be a dict or a JSON string
        - source_label is used in error messages (e.g., 'filter_data' or 'filter')
        """
        try:
            if isinstance(raw_filter, str):
                return json.loads(raw_filter)
            if isinstance(raw_filter, dict):
                return raw_filter
            raise DRFValidationError(
                {
                    "message": f"'{source_label}' must be a dict or a JSON string.",
                    "code": "invalid_filter_type",
                }
            )
        except json.JSONDecodeError:
            raise DRFValidationError(
                {
                    "message": (f"Invalid JSON for '{source_label}'. Expected a valid JSON object."),
                    "code": "invalid_json",
                }
            )

    def _apply_json_filter(self, queryset, filter_data, view):
        """Process a JSON filter structure using Q object composition."""
        if not filter_data:
            return queryset

        # Validate structure and depth before field allowlist checks
        max_depth = self._get_max_depth(view)
        self._validate_structure(filter_data, max_depth=max_depth, current_depth=1)

        # Validate against the view's FilterSet (only declared filters are allowed)
        self._validate_fields(filter_data, view)

        # Build combined Q object from the filter tree
        combined_q = self._evaluate_node(filter_data, view, queryset)
        if combined_q is None:
            return queryset

        # Apply the combined Q object to the queryset once
        return queryset.filter(combined_q)

    def _validate_fields(self, filter_data, view):
        """Validate that filtered fields are defined in the view's FilterSet."""
        filterset_class = getattr(view, "filterset_class", None)
        allowed_fields = set(filterset_class.base_filters.keys()) if filterset_class else None
        if not allowed_fields:
            # If no FilterSet is configured, reject filtering to avoid unintended exposure # noqa: E501
            raise DRFValidationError(
                {
                    "message": ("Filtering is not enabled for this endpoint (missing filterset_class)"),
                    "code": "filtering_not_enabled",
                }
            )

        # Extract field names from the filter data
        fields = self._extract_field_names(filter_data)

        # Check if all fields are allowed
        for field in fields:
            custom_property_filter = self._parse_custom_property_filter(field)
            if custom_property_filter:
                property_id, lookup = custom_property_filter
                property_instance = self._get_custom_property(property_id, view)
                if lookup not in CUSTOM_PROPERTY_LOOKUPS[property_instance.property_type]:
                    raise DRFValidationError(
                        {
                            "message": (
                                f"Lookup '{lookup}' is not supported for custom property type "
                                f"'{property_instance.property_type}'"
                            ),
                            "code": "invalid_custom_property_lookup",
                        }
                    )
                continue

            if isinstance(field, str) and field.startswith("customproperty_"):
                raise DRFValidationError(
                    {
                        "message": f"Invalid custom property filter field '{field}'",
                        "code": "invalid_custom_property_filter",
                    }
                )

            # Field keys must match FilterSet filter names (including any lookups)
            # Example: 'sequence_id__gte' should be declared in base_filters
            # Special-case __range: require the '<base>__range' filter itself
            if field not in allowed_fields:
                raise DRFValidationError(
                    {
                        "message": f"Filtering on field '{field}' is not allowed",
                        "code": "invalid_filter_field",
                    }
                )

    def _transform_field_name_for_validation(self, field_name):
        """Hook: Transform a field name before validation.

        Override this in subclasses to handle special field naming conventions.

        Args:
            field_name: The original field name from the filter data

        Returns:
            The transformed field name to validate against the FilterSet
        """
        return field_name

    def _extract_field_names(self, filter_data):
        """Extract all field names from a nested filter structure"""
        if isinstance(filter_data, dict):
            fields = []
            for key, value in filter_data.items():
                if key.lower() in ("or", "and", "not"):
                    # This is a logical operator, process its children
                    if key.lower() == "not":
                        # 'not' has a dict as its value, not a list
                        if isinstance(value, dict):
                            fields.extend(self._extract_field_names(value))
                    else:
                        # 'or' and 'and' have lists as their values
                        for item in value:
                            fields.extend(self._extract_field_names(item))
                else:
                    # This is a field name - apply transformation hook
                    transformed_field = self._transform_field_name_for_validation(key)
                    fields.append(transformed_field)
            return fields
        return []

    def _evaluate_node(self, node, view, queryset):
        """
        Recursively evaluate a JSON node into a combined Q object.

        Rules:
        - leaf dict → evaluated through FilterSet to produce a Q object
        - {"or": [...]} → Q() | Q() | ... (OR of children)
        - {"and": [...]} → Q() & Q() & ... (AND of children)
        - {"not": {...}} → ~Q() (negation of child)

        Returns a Q object that can be applied to a queryset.
        """
        if not isinstance(node, dict):
            return None

        # 'or' combination - OR of child Q objects
        if "or" in node:
            children = node["or"]
            if not isinstance(children, list) or not children:
                return None
            combined_q = Q()
            for child in children:
                child_q = self._evaluate_node(child, view, queryset)
                if child_q is None:
                    continue
                combined_q |= child_q
            return combined_q

        # 'and' combination - AND of child Q objects
        if "and" in node:
            children = node["and"]
            if not isinstance(children, list) or not children:
                return None
            combined_q = Q()
            for child in children:
                child_q = self._evaluate_node(child, view, queryset)
                if child_q is None:
                    continue
                combined_q &= child_q
            return combined_q

        # 'not' negation - negate the child Q object
        if "not" in node:
            child = node["not"]
            if not isinstance(child, dict):
                return None
            child_q = self._evaluate_node(child, view, queryset)
            if child_q is None:
                return None
            return ~child_q

        # Leaf dict: evaluate via FilterSet to get a Q object
        return self._build_leaf_q(node, view, queryset)

    def _preprocess_leaf_conditions(self, leaf_conditions, view, queryset):
        """Hook: Preprocess leaf conditions before building Q object.

        Override this in subclasses to transform filter keys/values.
        For example, custom property filters might need to be transformed
        from 'customproperty_<id>__<lookup>' to 'customproperty_value__<lookup>'.

        Args:
            leaf_conditions: Dict of field filters
            view: The view instance
            queryset: The queryset being filtered

        Returns:
            Dict of transformed field filters
        """
        return leaf_conditions

    def _build_leaf_q(self, leaf_conditions, view, queryset):
        """Build a Q object from leaf filter conditions using the view's FilterSet.

        We serialize the leaf dict into a QueryDict and let the view's
        filterset_class perform validation and build a combined Q object
        from all the field filters.

        Returns a Q object representing all the field conditions in the leaf.
        """
        if not leaf_conditions:
            return Q()

        custom_conditions = {}
        standard_conditions = {}
        for key, value in leaf_conditions.items():
            if self._parse_custom_property_filter(key):
                custom_conditions[key] = value
            else:
                standard_conditions[key] = value

        combined_q = Q()
        for key, value in custom_conditions.items():
            combined_q &= self._build_custom_property_q(key, value, view)

        if not standard_conditions:
            return combined_q

        # Get the filterset class from the view
        filterset_class = getattr(view, "filterset_class", None)
        if not filterset_class:
            raise DRFValidationError(
                {
                    "message": ("Filtering requires a filterset_class to be defined on the view"),
                    "code": "filterset_missing",
                }
            )

        # Apply preprocessing hook
        processed_conditions = self._preprocess_leaf_conditions(standard_conditions, view, queryset)

        # Build a QueryDict from the leaf conditions
        qd = QueryDict(mutable=True)
        for key, value in processed_conditions.items():
            # Default serialization to string; QueryDict expects strings
            if isinstance(value, list):
                # Repeat key for list values (e.g., __in)
                qd.setlist(key, [str(v) for v in value])
            else:
                qd[key] = "" if value is None else str(value)

        qd = qd.copy()
        qd._mutable = False

        # Instantiate the filterset with the actual queryset
        # Custom filter methods may need access to the queryset for filtering
        fs = filterset_class(data=qd, queryset=queryset)

        if not fs.is_valid():
            ve = translate_validation(fs.errors)
            raise DRFValidationError(
                {
                    "message": "Invalid filter parameters",
                    "code": "invalid_filterset",
                    "errors": ve.detail,
                }
            )

        # Build and return the combined Q object
        if not hasattr(fs, "build_combined_q"):
            raise DRFValidationError(
                {
                    "message": ("FilterSet must have build_combined_q method for complex filtering"),
                    "code": "missing_build_combined_q",
                }
            )

        return combined_q & fs.build_combined_q()

    def _parse_custom_property_filter(self, field_name):
        if not isinstance(field_name, str):
            return None
        match = CUSTOM_PROPERTY_FILTER_PATTERN.fullmatch(field_name)
        if not match:
            return None
        try:
            return str(UUID(match.group(1))), match.group(2)
        except ValueError:
            return None

    def _get_custom_property(self, property_id, view):
        cache = getattr(view, "_custom_property_filter_cache", None)
        if cache is None:
            cache = {}
            setattr(view, "_custom_property_filter_cache", cache)
        if property_id in cache:
            return cache[property_id]

        properties = ProjectWorkItemProperty.objects.filter(
            id=property_id,
            archived_at__isnull=True,
            deleted_at__isnull=True,
        )
        slug = getattr(view, "kwargs", {}).get("slug")
        project_id = getattr(view, "kwargs", {}).get("project_id")
        if slug:
            properties = properties.filter(workspace__slug=slug)
        if project_id:
            properties = properties.filter(project_id=project_id)

        property_instance = properties.only("id", "property_type").first()
        if not property_instance:
            raise DRFValidationError(
                {
                    "message": f"Custom property '{property_id}' is not available for this endpoint",
                    "code": "invalid_custom_property",
                }
            )
        cache[property_id] = property_instance
        return property_instance

    def _build_custom_property_q(self, field_name, raw_value, view):
        property_id, lookup = self._parse_custom_property_filter(field_name)
        property_instance = self._get_custom_property(property_id, view)
        value_queryset = WorkItemPropertyValue.objects.filter(
            issue_id=OuterRef("pk"),
            property_id=property_id,
            deleted_at__isnull=True,
        )

        if lookup == "isnull":
            is_null = self._coerce_boolean(raw_value)
            populated_value_exists = Exists(value_queryset.exclude(value=None))
            return ~Q(populated_value_exists) if is_null else Q(populated_value_exists)

        if property_instance.property_type == WorkItemPropertyType.MULTI_SELECT:
            values = self._as_list(raw_value) if lookup == "in" else [raw_value]
            multi_value_q = Q()
            for value in values:
                multi_value_q |= Q(value__contains=[str(value)])
            return Q(Exists(value_queryset.filter(multi_value_q)))

        if lookup == "icontains":
            value_queryset = value_queryset.annotate(
                custom_scalar=RawSQL("value #>> '{}'", ()),
            ).filter(custom_scalar__icontains=str(raw_value))
            return Q(Exists(value_queryset))

        if lookup == "range":
            values = self._as_list(raw_value)
            if len(values) != 2:
                raise DRFValidationError(
                    {
                        "message": f"Range filter '{field_name}' requires exactly two values",
                        "code": "invalid_custom_property_range",
                    }
                )
            coerced_values = [self._coerce_property_value(property_instance.property_type, value) for value in values]
            scalar_text = RawSQL("value #>> '{}'", ())
            if property_instance.property_type == WorkItemPropertyType.NUMBER:
                value_queryset = value_queryset.annotate(custom_scalar=Cast(scalar_text, FloatField()))
            elif property_instance.property_type == WorkItemPropertyType.DATE:
                value_queryset = value_queryset.annotate(custom_scalar=Cast(scalar_text, DateField()))
                coerced_values = [date.fromisoformat(value) for value in coerced_values]
            return Q(Exists(value_queryset.filter(custom_scalar__range=coerced_values)))

        if lookup == "in":
            values = [
                self._coerce_property_value(property_instance.property_type, value)
                for value in self._as_list(raw_value)
            ]
            return Q(Exists(value_queryset.filter(value__in=values)))

        value = self._coerce_property_value(property_instance.property_type, raw_value)
        return Q(Exists(value_queryset.filter(value=value)))

    def _as_list(self, value):
        if isinstance(value, (list, tuple)):
            return list(value)
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return [value]

    def _coerce_property_value(self, property_type, value):
        if property_type == WorkItemPropertyType.NUMBER:
            try:
                return float(value)
            except (TypeError, ValueError):
                raise DRFValidationError(
                    {
                        "message": f"'{value}' is not a valid number",
                        "code": "invalid_custom_property_number",
                    }
                )
        if property_type == WorkItemPropertyType.CHECKBOX:
            return self._coerce_boolean(value)
        if property_type == WorkItemPropertyType.DATE:
            try:
                return date.fromisoformat(str(value)).isoformat()
            except ValueError:
                raise DRFValidationError(
                    {
                        "message": f"'{value}' is not a valid ISO date",
                        "code": "invalid_custom_property_date",
                    }
                )
        return str(value)

    def _coerce_boolean(self, value):
        if value in (True, 1, "1", "true", "True"):
            return True
        if value in (False, 0, "0", "false", "False"):
            return False
        raise DRFValidationError(
            {
                "message": f"'{value}' is not a valid boolean",
                "code": "invalid_custom_property_boolean",
            }
        )

    def _get_max_depth(self, view):
        """Return the maximum allowed nesting depth for complex filters.

        Falls back to class default if the view does not specify it or has
        an invalid value.
        """
        value = getattr(view, "complex_filter_max_depth", self.default_max_depth)
        try:
            value_int = int(value)
            if value_int <= 0:
                return self.default_max_depth
            return value_int
        except Exception:
            return self.default_max_depth

    def _validate_structure(self, node, max_depth, current_depth):
        """Validate JSON structure and enforce nesting depth.

        Rules:
        - Each object may contain only one logical operator:
          or/and/not (case-insensitive)
        - Logical operator objects cannot contain field keys alongside the
          operator
        - or/and values must be non-empty lists of dicts
        - not value must be a dict
        - Leaf objects must only contain field keys and acceptable values
        - Depth must not exceed max_depth
        """
        if current_depth > max_depth:
            raise DRFValidationError(
                {
                    "message": (f"Filter nesting is too deep (max {max_depth}); found depth {current_depth}"),
                    "code": "max_depth_exceeded",
                }
            )

        if not isinstance(node, dict):
            raise DRFValidationError(
                {
                    "message": "Each filter node must be a JSON object",
                    "code": "invalid_filter_node",
                }
            )

        if not node:
            raise DRFValidationError(
                {
                    "message": "Filter objects must not be empty",
                    "code": "empty_filter_object",
                }
            )

        logical_keys = [k for k in node.keys() if isinstance(k, str) and k.lower() in ("or", "and", "not")]

        if len(logical_keys) > 1:
            raise DRFValidationError(
                {
                    "message": ("A filter object cannot contain multiple logical operators at the same level"),
                    "code": "multiple_logical_operators",
                }
            )

        if len(logical_keys) == 1:
            op_key = logical_keys[0]
            # must not mix operator with other keys
            if len(node) != 1:
                raise DRFValidationError(
                    {
                        "message": (f"Cannot mix logical operator '{op_key}' with field keys at the same level"),
                        "code": "mixed_operator_and_fields",
                    }
                )

            op = op_key.lower()
            value = node[op_key]

            if op in ("or", "and"):
                if not isinstance(value, list) or len(value) == 0:
                    raise DRFValidationError(
                        {
                            "message": f"'{op}' must be a non-empty list of filter objects",
                            "code": "invalid_operator_children",
                        }
                    )
                for child in value:
                    if not isinstance(child, dict):
                        raise DRFValidationError(
                            {
                                "message": f"All children of '{op}' must be JSON objects",
                                "code": "invalid_operator_child_type",
                            }
                        )
                    self._validate_structure(
                        child,
                        max_depth=max_depth,
                        current_depth=current_depth + 1,
                    )
                return

            if op == "not":
                if not isinstance(value, dict):
                    raise DRFValidationError(
                        {
                            "message": "'not' must be a single JSON object",
                            "code": "invalid_not_child",
                        }
                    )
                self._validate_structure(value, max_depth=max_depth, current_depth=current_depth + 1)
                return

        # Leaf node: validate fields and values
        self._validate_leaf(node)

    def _validate_leaf(self, leaf):
        """Validate a leaf dict containing field lookups and values."""
        if not isinstance(leaf, dict) or not leaf:
            raise DRFValidationError(
                {
                    "message": "Leaf filter must be a non-empty JSON object",
                    "code": "invalid_leaf",
                }
            )

        for key, value in leaf.items():
            if isinstance(key, str) and key.lower() in ("or", "and", "not"):
                raise DRFValidationError(
                    {
                        "message": "Logical operators cannot appear in a leaf filter object",
                        "code": "operator_in_leaf",
                    }
                )

            # Lists/Tuples must contain only scalar values
            if isinstance(value, (list, tuple)):
                if len(value) == 0:
                    raise DRFValidationError(
                        {
                            "message": f"List value for '{key}' must not be empty",
                            "code": "empty_list_value",
                        }
                    )
                for item in value:
                    if not self._is_scalar(item):
                        raise DRFValidationError(
                            {
                                "message": f"List value for '{key}' must contain only scalar items",
                                "code": "non_scalar_list_item",
                            }
                        )
                continue

            # Scalars and None are allowed
            if not self._is_scalar(value):
                raise DRFValidationError(
                    {
                        "message": (f"Value for '{key}' must be a scalar, null, or list/tuple of scalars"),
                        "code": "invalid_value_type",
                    }
                )

    def _is_scalar(self, value):
        return value is None or isinstance(value, (str, int, float, bool))
