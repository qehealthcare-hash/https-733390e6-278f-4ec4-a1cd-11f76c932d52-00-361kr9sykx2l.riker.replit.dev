# Audit log system

## Table: `hh_audit_logs`

**Inspect in Supabase** (run before/after migration):

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'hh_audit_logs'
) AS audit_table_exists;
```

If the table is missing or on the legacy CRM shape (`entity_type`, `actor_user_id`, text `id`), apply:

`hominal_crm_supabase_014_audit_system_safe.sql` (additive only — no drops).

### Columns (API / service layer)

| Field | Column | Notes |
| --- | --- | --- |
| Module name | `module` | e.g. `patient`, `billing`, `payout` |
| Action type | `action` | `create`, `update`, `close`, `deactivate`, `status_change`, `delete` |
| Record ID | `entity_id` | Primary key of the affected row |
| Old value | `before` | JSON snapshot before change |
| New value | `after` | JSON snapshot after change |
| User | `actor` (email) + `user_id` (`hh_users.id`) when available |
| Timestamp | `created_at` | Server default `now()`; human `stamp` optional |

## Architecture

1. **Domain mutation runs first** (insert/update/delete on the business table).
2. **`writeMutationAudit`** appends one row to `hh_audit_logs` (separate insert — does not wrap the business row in a DB transaction).
3. **`finalizeWithAudit`** returns API success only when the audit insert succeeded.

If step 2 fails after step 1 succeeded, the API returns **503** `audit_write_failed` with:

```json
{
  "success": false,
  "code": "audit_write_failed",
  "details": {
    "persisted": true,
    "warning": "The database change was saved but could not be written to the audit log..."
  }
}
```

Set `API_AUDIT_DISABLED=true` only in CI/unit tests.

DB triggers (`hh_audit_trigger` from migration 012/013) may also write rows; the service layer trail is authoritative for `/api/v1` mutations.

## Covered operations

| Module | Operations |
| --- | --- |
| `patient` | create, update, deactivate (`remove`), assign |
| `employee` | create, update, deactivate (`setStatus` ≠ Active), legacy sync |
| `duty` | create, update, delete (cancel) |
| `attendance` | create, **update**, mark |
| `billing` | create, update, **close**, reopen, generate, receipts |
| `payout` | create/ensure, update, adjust, **close** (lock), reopen, mark paid |
| `inquiry` | update, **status_change**, convert, legacy sync |

## Viewing audits

- **API:** `GET /api/v1/audits?module=patient&entity_id=PID000001&limit=50`
- **UI:** `/audits` (React shell, permission `audits.read`)
- **Patient history:** `GET /api/v1/patients/:id/history` includes `audits[]`

## Manual verification

```bash
cd vercel-web
export CRM_BASE_URL=https://crm.hominalhealthcare.com
export CRM_TOKEN="<supabase-access-token>"
node scripts/verify-audit-trail.mjs
```

Or after each action in the UI, open `/audits` and filter by `entity_id`.

Expected after tests:

1. **Edit patient** → `module=patient`, `action=update`, `entity_id=<patient id>`
2. **Close bill** → `module=billing`, `action=close`
3. **Close payout** (lock) → `module=payout`, `action=close`
