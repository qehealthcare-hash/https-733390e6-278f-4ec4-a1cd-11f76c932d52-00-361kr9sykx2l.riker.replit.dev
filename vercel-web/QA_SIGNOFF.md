# Hominal CRM — Enterprise QA Sign-Off (Phase 16)

Use this checklist after each production promotion. Run as **Admin** and as a **restricted role** (e.g. Staff). Every workflow: **create → refresh → re-login**.

**Production:** https://crm.hominalhealthcare.com  
**Health:** `GET /api/v1/health` → `success: true`, `monitoring.sentry` reflects DSN config

---

## Automated gates (CI / local)

- [ ] `cd vercel-web && npm test` — all Vitest tests pass
- [ ] `npm run build` — no errors
- [ ] `npm run test:e2e` — API smoke passes
- [ ] Optional: `E2E_EMAIL` / `E2E_PASSWORD` → `e2e/critical-flow.spec.ts`

---

## Registry & intake

- [ ] Patient create/edit persists after refresh
- [ ] Inquiry convert copies fields; follow-up date enforced when required
- [ ] Employee list paginates; Staff cannot mutate without permission

---

## Operations

- [ ] Duty assign / cancel; locked payout month blocks materialize
- [ ] Attendance day-mark matches board after refresh

---

## Financial (critical)

- [ ] Create provisional bill for period
- [ ] Partial receipt → second receipt excludes paid days
- [ ] Delete receipt releases paid days (check `hh_duty_days.paid_receipt_id` null in DB)
- [ ] Close bill requires reason; patient status updates
- [ ] Payout partial pay; delete payout releases unpaid days
- [ ] Automated route smoke: `npm test -- src/integration/__tests__/billingModule.smoke.test.ts` (PATCH/status/close/reopen + `expected_updated_at` / 409 conflict)
- [ ] Automated route smoke: `npm test -- src/integration/__tests__/payoutModule.smoke.test.ts` (adjust/lock/reopen/pay + optimistic lock)
- [ ] Automated auth smoke: `npm test -- src/integration/__tests__/authModule.smoke.test.ts` (login proxy, `/me`, refresh cookie, health)
- [ ] Automated attendance smoke: `npm test -- src/integration/__tests__/attendanceModule.smoke.test.ts` (mark/PATCH/DELETE/day-mark + `expected_updated_at` / 409 conflict)

---

## Reports & parity

- [ ] Dashboard KPIs match Reports overview for same month
- [ ] Reports inquiry/patient/attendance/billing tabs show server totals (not capped sample)
- [ ] CSV export matches on-screen totals

---

## Security

- [ ] Apply migration `20260601210000_revoke_authenticated_business_rpc.sql` (business RPC EXECUTE → `service_role` only; `hh_idempotency` server-only policy)
- [ ] Apply migration `20260601220000_audit_triggers_core_modules.sql` (`trg_audit_*` on duties, attendance, payouts, patients, employees, inquiries)
- [ ] Realtime lists (patients/employees/inquiries/audits via `useRealtimeResource`, billings + attendance pages) stay subscribed after token refresh — no `auth.supabase` in effect deps
- [ ] Nurse JWT cannot call `/rest/v1/rpc/hominal_*` directly (403 / permission denied, not 200)
- [ ] Role without `canManage` cannot mutate employees/settings
- [ ] `/legacy` not linked from main nav; Classic CRM only when intentional
- [ ] Apply migration `20260601230000_r5_idempotency_auth_hardening.sql` (`hh_idempotency` grants + RLS → `service_role` only)
- [ ] Supabase: leaked-password protection **enabled** (Auth → Email); run `node scripts/verify-auth-hibp.mjs` when `SUPABASE_ACCESS_TOKEN` is set
- [ ] Supabase: daily backups / PITR **enabled**

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Engineering | | | Pass / Fail |
| Operations | | | Pass / Fail |
| Business owner | | | Pass / Fail |

**Enterprise readiness score after sign-off:** **100 / 100** (code + DB migrations applied + this checklist complete)
