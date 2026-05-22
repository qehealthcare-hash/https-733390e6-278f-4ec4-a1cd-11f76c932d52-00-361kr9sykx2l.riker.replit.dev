# CRM integration test report

**Date:** 2026-05-22  
**Scope:** Full-workflow validation after the module refactor (Phases 1–10 + audit)  
**Runners:** Vitest (`npm test`), TypeScript (`npm run typecheck`), `scripts/integration-smoke.mjs`

---

## Status: core workflow PASS (local + code); production smoke ready

| Layer | Result |
|-------|--------|
| Unit / rule tests | **75/75 PASS** |
| Local HTTP smoke (`http://127.0.0.1:3099`) | **26/26 PASS** |
| Production deploy | **READY** (`dpl_GhMyTtKG7iPNigUmsBcn7YMdx1rP`) |
| Production HTTP smoke | Run after deploy (see below) |

---

## How to reproduce

```bash
cd vercel-web
npm ci
npm run typecheck
npm test

# Auth token (uses SUPABASE_SERVICE_ROLE_KEY from your shell):
export SUPABASE_URL=https://hkyjxdmkqkydnrafhpgn.supabase.co
export SUPABASE_ANON_KEY="<anon-key>"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export CRM_PASSWORD="HominalSmoke2026!"   # optional; script sets temp password if omitted
export CRM_TOKEN="$(node scripts/smoke-login.mjs)"

# Local (recommended first):
npm run build && npx next start -p 3099
export CRM_BASE_URL=http://127.0.0.1:3099
node scripts/integration-smoke.mjs

# Production:
export CRM_BASE_URL=https://crm.hominalhealthcare.com
node scripts/integration-smoke.mjs
```

---

## Production fixes shipped (2026-05-22)

1. **Vercel env** — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` on `hominal-healthcare-web` (health: `deps.supabase.ok = true`).
2. **Schema alignment** — API writes match production tables:
   - Employees: `status` ↔ `leave_date` (no `hh_employees.status` column).
   - Attendance: `notes` ↔ `remarks` (no `hh_attendance.notes`).
   - Billings: close/pause uses `status` only; close reason stored in `hh_audit_logs`.
3. **`vercel.json`** — Removed rewrite that proxied `/api/*` to legacy Express (`hominal-healthcare-api`), which caused **404** on Next-only routes (`/close`, `/lock`, `GET /:id`, etc.).
4. **`scripts/smoke-login.mjs`** — Obtains admin JWT for smoke tests.

---

## Live HTTP smoke checklist (26 steps)

| Step | Endpoint | Expected |
|------|----------|----------|
| health | `GET /api/v1/health` | 200, supabase ok |
| create patient | `POST /api/v1/patients` | 201 |
| duplicate patient | `POST /api/v1/patients` | 409 duplicate |
| invalid patient | `POST /api/v1/patients` | 422 validation_error |
| create employee | `POST /api/v1/employees` | 201 |
| create duty | `POST /api/v1/duties` | 201 |
| duplicate duty | `POST /api/v1/duties` | 409 |
| mark attendance | `POST /api/v1/attendance/mark` | 201 |
| generate bill | `POST /api/v1/billings/generate` | 201 |
| ensure payout | `POST /api/v1/payouts` | 201 |
| close bill | `POST /api/v1/billings/:id/close` | 200 |
| edit closed bill | `PATCH /api/v1/billings/:id` | 422 business_rule_violation |
| lock payout | `POST /api/v1/payouts/:id/lock` | 200 |
| adjust locked payout | `POST /api/v1/payouts/adjust` | 422 |
| dashboard / reports | `GET /api/v1/reports/*` | 200 |
| refetch entities | `GET /api/v1/{module}/:id` | 200 |
| audits | `GET /api/v1/audits` | 200 |
| deactivate employee | `PATCH /api/v1/employees/:id/status` | 200 |

**Local run:** all 26 passed against production Supabase.

**Production note:** Before `vercel.json` fix, steps 11–18 returned 404 (legacy API proxy). After deploy `dpl_GhMyTtKG7iPNigUmsBcn7YMdx1rP`, re-run smoke on `https://crm.hominalhealthcare.com`.

---

## Unit tests — PASSED (75)

See `docs/TEST_MATRIX.md` for file-level mapping. Highlights:

- `workflowMatrix.test.ts` — end-to-end rule chain
- `employeeRules.test.ts` — `leave_date` status mapping
- `auditTrail.test.ts` / `mutationAudit.test.ts` — audit enforcement

---

## Architecture (confirmed)

```
HTTP → withAuth (ActorContext: email, userId, role)
     → *Service (Zod → business rules → repository)
     → Supabase (service role)
     → writeMutationAudit → hh_audit_logs
     → finalizeWithAudit (503 if audit fails after DB write)
```

---

## Optional DB migrations (not required for smoke pass)

| File | Purpose |
|------|---------|
| `hominal_crm_supabase_014_audit_system_safe.sql` | Audit columns (already present in prod) |
| `hominal_crm_supabase_015_employee_status.sql` | Add `hh_employees.status` if you want explicit column |
| `hominal_crm_supabase.sql` lines 493–495 | Add `close_reason`, `pause_reason` on billings for legacy SPA fields |

---

## Remaining manual checks

- Multi-tab Realtime sync (legacy SPA)
- Modal save buttons (legacy UI)
- Git push: `git push -u origin cursor/fix-service-open` (auth on your machine)

---

## Files touched (integration pass)

- `src/business/employeeRules.ts`, `src/database/employeeRepository.ts`
- `src/business/attendanceRules.ts`, `src/database/attendanceRepository.ts`
- `src/business/billingRules.ts`, `src/services/billingService.ts`, `src/database/billingRepository.ts`
- `src/services/employeeService.ts`
- `vercel.json`, `scripts/smoke-login.mjs`, `scripts/integration-smoke.mjs`
- `src/business/__tests__/employeeRules.test.ts`
