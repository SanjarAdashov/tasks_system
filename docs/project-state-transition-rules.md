# Project state transition rules

This customization adds project-scoped workflow guards to Plane. It is designed
to be portable with the rest of the custom Plane checkout and requires database
migration `db.0128_project_state_transition_rules`.

## Behavior

- Project Admins configure rules from the separate **State transitions**
  project-settings page.
- Rules are directed. `A -> B` and `B -> A` are independent.
- A rule source is one exact state, any existing state, or work-item creation.
- Exact and `ANY` rules are cumulative. Every applicable rule is evaluated,
  and a matching deny condition wins.
- Condition trees support nested `AND` and `OR` groups.
- Access conditions are intentionally returned to regular users as a generic
  denial. Validation conditions return the exact configured messages.
- Rules use the final proposed work-item values, so a status and the fields
  required for that transition can be submitted atomically.
- With strict mode disabled, an unconfigured transition is allowed. With
  strict mode enabled, it is rejected.
- Project Admin and system-operation bypasses are configured independently on
  each rule.
- Saving a draft is unrestricted. Moving a draft into a project evaluates the
  matching creation rule.
- An archived/deleted state archives active rules that reference it. Restoring
  the state does not restore those rules.
- Denied attempts and configuration changes are retained in the project audit
  log.

## Storage

- `project_state_transition_settings`
- `project_state_transition_rules`
- `project_state_transition_audit_logs`

Condition trees are JSON documents, validated to a maximum depth of 8 and a
maximum of 200 nodes. Active rule uniqueness is enforced in PostgreSQL for each
exact source/target pair and each `ANY` or `CREATE` target.

## App API

All paths are under
`/api/workspaces/{workspace_slug}/projects/{project_id}/state-transitions/`.

- `GET/PATCH settings/`
- `GET/POST rules/`
- `GET/PATCH/DELETE rules/{rule_id}/`
- `GET audit-logs/`
- `POST preview/`
- `POST available/`

Only Project Admins can mutate configuration, read the audit log, or run the
admin preview. Active project members can read settings/rules and request the
available transition list used by status selectors.

## Enforcement surfaces

The shared evaluator is called from the main app serializer, public API
serializer, Space serializer, draft conversion path, and automatic-close
worker. Bulk UI actions use the existing per-item update path, so allowed items
can succeed while rejected items roll back and show the server reason.

Direct status writes introduced by future code must call
`plane.utils.state_transition_rules.enforce_state_transition` or use one of the
enforcing serializers. Seed/migration-only writes are intentionally outside
runtime enforcement.

## Local verification

From the repository root:

```bash
docker compose -p plane-tests -f docker-compose-test.yml run --rm api-tests \
  pytest plane/tests/contract/app/test_project_state_transitions.py -q
```

The combined regression also includes:

- `test_project_state_order.py`
- `test_project_work_item_fields.py`
- `test_work_item_property_values.py`
- `test_work_item_property_surfaces.py`

Before release, also run Django `check`, `makemigrations --check --dry-run`,
targeted Ruff checks, shared TypeScript checks, web TypeScript checks, Oxfmt,
Oxlint, and `git diff --check`.

## Release and rollback

Do not deploy this migration separately from the backend image that contains
the new models. For the server release:

1. Back up PostgreSQL, uploads, Compose configuration, and environment files.
2. Build and publish the backend/frontend images from the same Git commit.
3. Point the server Compose override at those immutable image tags.
4. Run `python manage.py migrate`.
5. Recreate only the application containers that use the new images.
6. Verify Django checks, migration state, HTTP health, and an authenticated
   project-settings smoke test.

Application rollback is safe only while the new tables remain unused by an
older image. Normally leave migration `0128` applied during a short image
rollback; removing the migration deletes workflow configuration and audit data
and therefore requires an explicit database backup and approval.
