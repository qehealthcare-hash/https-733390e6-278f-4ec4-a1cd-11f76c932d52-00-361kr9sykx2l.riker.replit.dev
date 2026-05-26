# API integration & E2E tests

These suites exercise the **real route handlers** exported from
`app/api/v1/**/route.ts` against an in-memory Supabase mock. Each request
goes through:

```
NextRequest
  → withAuth (extracts Bearer → calls auth.getUser → loads hh_users row)
  → requireRole (RBAC gate)
  → parseJsonBody / parseInput
  → service method (mocked at the service surface)
  → respond() (canonical { success, data, error, code, details } envelope)
```

so any regression in routing, auth, role gating, envelope shape, or
service wiring fails CI.

## Files

| Suite | Covers |
| --- | --- |
| `authMe.route.test.ts` | `GET /auth/me`, `GET /health`. Validates the harness. |
| `patients.route.test.ts` | Full `/patients` + `/patients/[id]` matrix incl. `?hard=1`. |
| `employees.route.test.ts` | `/employees` list/create/get/patch/delete. |
| `duties.route.test.ts` | `/duties` create/list/cancel/hard-delete. |
| `billings.route.test.ts` | `/billings`, `/close`, `/receipts`, `/invoices`, `/regenerate`. |
| `payouts.route.test.ts` | List, ensure, recompute, lock, pay. |
| `attendance.route.test.ts` | List, create, day/mark, missing. |
| `auditsInquiries.route.test.ts` | Audit log + inquiries. |
| `uploads.route.test.ts` | Signed-URL: bucket whitelist + filename sanitization. |
| `cron.route.test.ts` | Cron token gating (Bearer + legacy header, prod fail-closed). |
| `whatsappWebhook.route.test.ts` | Meta handshake + HMAC signature verification. |
| `idempotency.route.test.ts` | `Idempotency-Key` cache + per-actor scoping + replay. |
| `lifecycle.e2e.test.ts` | Cross-route flows: patient → bill → invoice → receipt → close. |
| `rbacMatrix.route.test.ts` | Auto-generated role × route allow/deny table. |

## Harness

`src/test/routeHarness.ts` provides:

- `setActor(ACTORS.admin | ...)` — wires the `hh_users` row the next
  request resolves to.
- `setAuthOnly(email)` — valid Supabase token but no CRM provisioning.
- `makeRequest(method, url, { body, headers, noAuth, bearer, rawBody })`
  — builds the `NextRequest` Next.js will hand to the handler.
- `ctx({ id: "..." })` — wraps the Next 15 `params` Promise.
- `buildSupabaseMock()` — to be passed into `vi.mock("@/lib/api/supabase", ...)`.
- `buildMutationAuditMock()` — passed into
  `vi.mock("@/services/mutationAudit", ...)`.
- `resetIdempotencyStore()` — clears the in-memory `hh_idempotency`
  cache between tests.
- `expectOkEnvelope`, `expectCreatedEnvelope`, `expectErrorEnvelope` —
  assertion helpers that read & unwrap the canonical envelope.

## Running

```
npm test                    # full suite (unit + business + integration)
npx vitest run src/integration  # integration only
npx vitest watch src/integration/__tests__/billings.route.test.ts
```

No external services required — the Supabase, idempotency, and
mutation-audit layers are all stubbed.
