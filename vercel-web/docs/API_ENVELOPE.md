# API response envelope (Phase 6)

All `/api/v1/*` routes return a single canonical JSON shape.

## Success

```json
{
  "success": true,
  "data": { }
}
```

HTTP status: `200` (or `201` for creates).

## Failure

```json
{
  "success": false,
  "error": "Human-readable summary",
  "code": "validation_error",
  "details": { }
}
```

HTTP status follows `code`:

| `code` | HTTP |
| --- | --- |
| `validation_error` | 422 |
| `business_rule_violation` | 422 |
| `bad_request` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `duplicate` / `conflict` | 409 |
| `database_error` / `internal_error` | 500 |
| `upstream_error` | 502 |

## Route handler pattern

```typescript
import { respond } from "@/lib/api/apiResultBridge";
import { myService } from "@/services/myService";

export const GET = withAuth(async (req, { actor }) => {
  const result = await myService.list(query, { actor });
  return respond(result);
});

export const POST = withAuth(async (req, { actor }) => {
  const body = await parseJsonBody(req);
  const result = await myService.create(body, { actor });
  return respond(result, 201);
});
```

Services return `ApiResult<T>` from `@/types/common`. Routes never call
`supabase.from()` directly.

## Client (`lib/api-client.js`)

```javascript
const data = await request("/api/v1/patients", { method: "GET" }, session);
// Throws on success === false; returns `data` on success.
```

Supports legacy `{ ok, data, message }` during iframe migration (Phase 7).

## Audit enforcement (Phase 9)

Mutations through `src/services/*` call `finalizeWithAudit`. If the audit row
cannot be inserted, the API returns:

```json
{
  "success": false,
  "error": "Audit log write failed",
  "code": "audit_write_failed",
  "details": { "persisted": true, "module": "patient", "warning": "…" }
}
```

HTTP status **503**. Set `API_AUDIT_DISABLED=true` only in CI to skip audit writes.

Read trail: `GET /api/v1/audits?module=patient&entity_id=PID000001`.

## Exceptions

- `GET /api/v1/health` — public probe; returns `{ success: true, data: { service, deps } }`.
- `POST /api/v1/whatsapp/webhook` — uses `withoutAuth`; errors still use canonical envelope via `jsonError`.

## Legacy iframe (`public/legacy-crm.html`)

Still checks `res.ok` / `state.ok` in places. Phase 7 migrates those callers to
`/api/v1` + this envelope (or `api-client.js`).
