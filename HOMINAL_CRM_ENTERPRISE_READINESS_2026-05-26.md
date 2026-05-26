# Hominal Healthcare CRM — Enterprise Readiness (Post-Remediation)

**Assessment date:** 2026-05-26  
**Baseline audit:** [HOMINAL_CRM_ENTERPRISE_AUDIT_2026-05-18.md](./HOMINAL_CRM_ENTERPRISE_AUDIT_2026-05-18.md) (score **3.2 / 10**)  
**Canonical app:** `vercel-web` → https://crm.hominalhealthcare.com  
**Latest production deployment:** `dpl_8w8ujgQeMonyjBXdTbC1XpiNeBt4`  
**Automated QA:** 498 / 498 Vitest tests passing; Next.js 15.5.18 production build green

---

## Executive Summary

Nine remediation phases addressed the highest-risk gaps in auth, RBAC, CRUD workflows, cross-module business rules, UI accessibility, report accuracy, performance, and application security. The production entry point now routes to the Next.js app (`/` → `/dashboard`) instead of the legacy iframe shell.

The CRM is **operationally stabilised** for day-to-day use on the `hh_*` schema via the Next.js API layer, but is **not yet full ERP-grade** until remaining database work (duty ledger, receipt RPC transactions, applied migrations) is completed on Supabase.

**Post-remediation enterprise readiness score: 6.4 / 10** (↑ +3.2 from baseline)

---

## Dimension Scores

| Dimension | Baseline (May 18) | Current (May 26) | Notes |
|---|---:|---:|---|
| Architecture clarity | 3 | **6.5** | Single deploy target (`vercel-web`); home redirects to React dashboard; layered services + route tests |
| Supabase schema consistency | 3 | **5.5** | Corporate hardening migration authored; RLS/grants in repo — **must be applied** on production |
| Billing accuracy | 2 | **5.5** | Soft-delete filters, receipt caps, period-scoped totals; no `hh_duty_days` ledger yet |
| Payout accuracy | 2 | **5.5** | Locked payout blocks rematerialize; partner charges in reports; allocation constraints still partial |
| Security / RLS | 4 | **7.5** | DB-driven RBAC, webhook signatures, IDOR fixes, CSP, rate limits, sanitized 500s |
| Realtime sync | 2 | **4.5** | Realtime hooks + server pagination; legacy full-table patterns reduced, not eliminated |
| Frontend workflow stability | 4 | **7.0** | Mobile nav, accessible confirms, module pages; duties ESLint hook warnings remain |
| Deployment reliability | 3 | **7.5** | Repeatable `npm test` → `build` → `vercel deploy --prod`; 498 automated tests |
| Reporting accuracy | 3 | **6.5** | Server report APIs aligned to business dates; detail tabs capped at 100 rows |
| Performance readiness | 4 | **6.5** | Server pagination (50 default), payouts code-split, lazy camera |

---

## Phase Sign-Off (1–9)

| Phase | Focus | Status |
|---|---|---|
| 1 | DB hardening migration, repository soft-delete filters | **Done** (apply migration on Supabase) |
| 2 | Auth, RBAC, public-config, password reset, legacy JWT removed | **Done** |
| 3 | CRUD status workflows, mutation audits, employee UI gates | **Done** |
| 4 | Inquiry→patient copy, locked payout, attendance parity, receipt cap | **Done** (apply `20260526130000_*` migration) |
| 5 | Mobile nav, confirm dialog, a11y, empty/loading states | **Done** |
| 6 | Report truthfulness, CSV hygiene, billing period filters | **Done** |
| 7 | Pagination, code-split payouts, fetch caps | **Done** |
| 8 | CSP, rate limits, upload blocklist, sync route lockdown, idempotency table | **Done** (apply `20260526140000_*` migration) |
| 9 | Final QA, production deploy, readiness score | **Done** |

---

## Baseline vs Remediated — Critical Risks

| Risk (May 18 audit) | Remediation | Residual |
|---|---|---|
| Production root = legacy iframe | `/` → `/dashboard` React shell | `/legacy` still available for transition |
| Three divergent `legacy-crm.html` copies | Canonical path in `vercel-web`; API-first modules | Other repo copies may still exist — do not deploy from them |
| `public_access` RLS policies | Addressed in `20260526120000_corporate_hardening.sql` | **Apply migration** and verify advisors |
| Status changes via generic PATCH | Dedicated status/close/reopen endpoints | — |
| Report totals ≠ dashboard | Shared report rules + server APIs | Detail tabs sample max 100 rows |
| No pagination | Patients, employees, inquiries, audits paginated | Some filters still page-local |
| AI / conversation IDOR | Ownership checks on GET + ask | — |
| WhatsApp webhook unsigned | HMAC + rate limit | — |
| No automated billing tests | 498 Vitest tests incl. RBAC matrix | Not full browser E2E |

---

## Outstanding (Post–Phase 9)

**P0 — Apply on Supabase before claiming DB score above 6:**

1. `vercel-web/supabase/migrations/20260526120000_corporate_hardening.sql`
2. `vercel-web/supabase/migrations/20260526130000_inquiry_convert_patient_fields.sql`
3. `vercel-web/supabase/migrations/20260526140000_security_hardening.sql`

**P1 — Financial ledger (audit Phase 3 roadmap, not in scope of 1–9):**

- Create `hh_duty_days` + transactional receipt/payout RPCs
- Backfill from `hh_svc_entries`; dedupe duplicate service-day groups (51 flagged in audit)

**P2 — Ops / observability:**

- Daily Supabase backup policy
- Production error tracking (Sentry/Datadog)
- Manual regression pass per audit §L (refresh after each critical workflow)

**P3 — Polish:**

- Duties page React hook dependency warnings
- `next/image` for logos/document previews
- Employee list: server-side role/type/gender filters
- npm audit (2 moderate dev dependency advisories on Vercel build)

---

## Manual QA Checklist (recommended before go-live sign-off)

Run each workflow **create → refresh → re-login** as Admin and as a restricted role:

- [ ] Patient create/edit persists; billing lookup sees patient
- [ ] Inquiry convert copies fields; status requires follow-up date when applicable
- [ ] Duty assign / cancel; locked payout month blocks materialize
- [ ] Receipt partial pay → second receipt excludes paid days → delete releases days
- [ ] Dashboard KPIs match Reports overview for same period
- [ ] Role without `canManage` cannot mutate employees/settings
- [ ] Mobile: sidebar drawer, billing/patient actions reachable

---

## Deployment Record

| Step | Result |
|---|---|
| `npm test` | 498 passed |
| `npm run build` | Success (ESLint warnings only) |
| `vercel deploy --prod --yes` | `dpl_8w8ujgQeMonyjBXdTbC1XpiNeBt4` |
| Alias | https://crm.hominalhealthcare.com |

---

## Verdict

**Suitable for controlled production use** on the Next.js + API path with migrations applied and a short manual QA pass. **Not yet enterprise ERP** until duty-day ledger and database-enforced financial transactions are implemented.

**Score trajectory:** 3.2 → **6.4** (target **8.0+** after P1 ledger + applied migrations + E2E monitoring).
