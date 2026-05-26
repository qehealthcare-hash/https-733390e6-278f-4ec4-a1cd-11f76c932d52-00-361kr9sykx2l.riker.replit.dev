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

---

## Reports & parity

- [ ] Dashboard KPIs match Reports overview for same month
- [ ] Reports inquiry/patient/attendance/billing tabs show server totals (not capped sample)
- [ ] CSV export matches on-screen totals

---

## Security

- [ ] Role without `canManage` cannot mutate employees/settings
- [ ] `/legacy` not linked from main nav; Classic CRM only when intentional
- [ ] Supabase: leaked-password protection **enabled** (Auth → Email)
- [ ] Supabase: daily backups / PITR **enabled**

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Engineering | | | Pass / Fail |
| Operations | | | Pass / Fail |
| Business owner | | | Pass / Fail |

**Enterprise readiness score after sign-off:** **100 / 100** (code + DB migrations applied + this checklist complete)
