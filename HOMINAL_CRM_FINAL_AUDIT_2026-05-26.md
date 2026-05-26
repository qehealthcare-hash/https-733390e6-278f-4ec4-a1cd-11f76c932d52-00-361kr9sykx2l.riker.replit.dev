# Hominal Healthcare CRM — Final Revaluation & Audit

**Date:** 2026-05-26 18:05 IST  
**Method:** evidence-based — repo grep, `npm test`, `npm run build`, Vercel inspect, live HTTP probes, Supabase MCP.  
**Canonical app:** `vercel-web/` → https://crm.hominalhealthcare.com  
**Supabase project:** `hkyjxdmkqkydnrafhpgn` (`ap-northeast-1`, Postgres 17.6.1, project metadata = `ACTIVE_HEALTHY`)

> This document supersedes the optimistic 100/100 verdict in `HOMINAL_CRM_ENTERPRISE_READINESS_2026-05-26.md`. The codebase has come a very long way (32 → ~96 on the dimension scorecard) but **live production has real, observable gaps today** that prevent an honest 100.

---

## 1 — What I verified just now

### 1.1 Code & CI (green)
| Check | Result |
|---|---|
| `npm test` (Vitest) | **527 / 527 passing** (48 files, ~3 s) |
| `npm run build` | **Success** — no TS errors, ESLint warnings only |
| TypeScript lint on touched files | **No errors** |

### 1.2 Vercel deploy (green)
| Check | Result |
|---|---|
| Latest production deploy | `dpl_3fhvz1SMJfLVX9KAa4CYLuaUvCtC` — **Ready** (this audit pass, regression-fix build) |
| Previous prod deploy | `dpl_DiswcCGxHEhCt6QhWtLmj1545ezW` (Phase 16 build) |
| Aliases | `crm.hominalhealthcare.com`, `hominal-healthcare-web.vercel.app` |

### 1.3 Live HTTP probes
| Endpoint | Status | Notes |
|---|---|---|
| `GET /` | **307** → `/dashboard` (~1.8 s) | OK |
| `GET /login` | **200** (~0.9 s) | OK |
| `GET /api/v1/health` | **200 after ~21 s** | Body returns `success:true` but `deps.supabase.ok: false, error: "unavailable"` |

Health body captured at 12:35 UTC:

```json
{"success":true,"data":{"service":"hominal-crm-api","version":1,
 "time":"2026-05-26T12:35:53.218Z",
 "deps":{"supabase":{"ok":false,"error":"unavailable"},
         "openai":false,"whatsapp":false},
 "monitoring":{"sentry":false}}}
```

### 1.4 Supabase reachability (from MCP + direct REST)
| Check | Result |
|---|---|
| `list_projects`, `get_project`, `get_project_url`, `get_publishable_keys` | **OK** — control-plane responds, `status: ACTIVE_HEALTHY` |
| `execute_sql("select 1")` (MCP) | **Times out** (~30 s, repeated 15+ times) |
| `apply_migration` / `list_migrations` (MCP) | **Times out** |
| `GET /rest/v1/` (PostgREST root) | 401 in 0.4 s — service reachable |
| `GET /rest/v1/hh_users` (anon, HEAD) | **Times out** (15 s, no bytes received) |
| Production `/api/v1/health` | 200 in **~20 s**; `deps.supabase.ok: false, error: "unavailable"` |
| Production runtime logs (1 h, error/warning/fatal) | None found; dashboard polls return 401 fast (auth middleware), so the DB outage shows as `unavailable` not 500 |

Conclusion: the Postgres pooler is timing out queries from every channel (MCP, production app, direct PostgREST) even though the control-plane reports `ACTIVE_HEALTHY`. **This is a real production incident on the Supabase project, not a config or code issue.** Operator action: see §7.

---

## 2 — The regression I caught and fixed during this audit

**Symptom:** Phase 16 (this conversation, earlier turn) removed the defensive parallel `dutyDayLedger.syncReceiptCreated` / `syncReceiptDeleted` calls from `billingService.recordPayment` / `softDeleteReceipt`, on the assumption that the Phase 16 RPC migration (`20260526160000_phase16_ledger_rpc_views.sql`) would be applied on Supabase. **That migration was never applied** (MCP `apply_migration` timed out and we did not retry to completion).

**Consequence shipped in `dpl_DiswcCGxHEhCt6QhWtLmj1545ezW`:** receipt create and delete operations would have stopped updating `public.hh_duty_days` — meaning the ledger would silently drift the next time a receipt was added or removed in production. Reports built on top of `hh_duty_days` would have under-reported "paid duty-days".

**Fix shipped in `dpl_3fhvz1SMJfLVX9KAa4CYLuaUvCtC`:**
- Restored idempotent `dutyDayLedger.syncReceiptCreated` after `recordPayment`
- Restored idempotent `dutyDayLedger.syncReceiptDeleted` after `softDeleteReceipt`
- Updated `src/services/__tests__/dutyDayLedger.test.ts` (`softDeleteReceipt` now expects `releaseFromPatient` to be called)

The defensive sync is idempotent and safe even after the Phase 16 RPC is applied — both write to `hh_duty_days` but only touch the same rows.

---

## 3 — Score: dimension-by-dimension (0–100), evidence-based

| Weight | Dimension | Score | Why |
|---:|---|---:|---|
| 8% | Architecture clarity | **92** | Single canonical app (`vercel-web/`); `/` → `/dashboard`; layered services / repositories / validation; legacy iframe quarantined under `/legacy` with `noindex`. |
| 12% | Supabase schema & data integrity | **80** | 6 migrations committed; Phases 10–11 applied (verified earlier); **Phase 16 (`20260526160000_*`) NOT applied** — capped here until applied. `hh_duty_days` ledger exists in prod with backfill. |
| 15% | Billing accuracy | **90** | Receipt cap at billing level, bill lock guards, paid-status recompute, defensive ledger sync. Phase 16 RPC pending → −10 because atomicity is still application-level, not DB-level. |
| 15% | Payout accuracy | **88** | Locked payout blocks materialize, partner charges, day-ledger link via `paid_charge_id`. Same pending atomicity gap. |
| 12% | Security & access control | **86** | RBAC 91-case matrix, CSP, webhook HMAC, idempotency table, sync routes locked. RLS depends on applied migrations (verified for Phases 10–11; Phase 16 not blocking RLS). HIBP leaked-password protection is a manual dashboard step that hasn't been confirmed enabled. |
| 5% | Realtime & data freshness | **75** | `usePaginatedResource` + Supabase realtime on patients, employees, inquiries, audits; reports use server summaries. Legacy `legacy-crm.html` still has `limit=1000` patient query, but it's quarantined. |
| 10% | Frontend workflow stability | **86** | Mobile drawer, confirm-dialog, a11y `aria-current`, duties `useCallback` cleanup, `BrandLogo` with `next/image`. Some pages still rely on page-local filters. |
| 8% | Deployment & test reliability | **88** | 527 Vitest passing, build green, Vercel CLI deploys clean, Playwright API smoke. Sentry wired in code but **DSN not set in Vercel env** → `monitoring.sentry: false` in live health. E2E credentials not configured. |
| 10% | Reporting accuracy | **88** | Server-side `/api/v1/reports/{inquiries,patients,attendance,billings}` with `count='exact'`, KPIs from `summary`, CSV uses server totals. Phase 16 SQL views (`hh_v_billing_receipt_totals`, `hh_v_duty_days_open`) not yet applied. |
| 5% | Performance readiness | **82** | Default page size 50, code-split payouts, route shells small, indexes committed (Phase 16 indexes not applied). Currently degraded by upstream Supabase latency. |

**Weighted overall (code + repo evidence):** **≈ 86 / 100**

**Apply Phase 16 migration + set Sentry/OpenAI/WhatsApp env vars + recover Supabase connectivity → ≈ 94 / 100** (the missing ~6 points are the manual dashboard checks listed in `vercel-web/QA_SIGNOFF.md` + Supabase HIBP protection + business sign-off).

---

## 4 — Concrete blockers (in priority order)

### P0 — happening right now
1. **Supabase database unreachable from production**. `/api/v1/health` returns `deps.supabase.ok: false, error: "unavailable"`. Same project responds for control-plane metadata but rejects SQL. Likely causes: pooler exhaustion, project paused on free tier, transient outage, or rate limiting. **Action:** open Supabase dashboard → check connection pooler status, restart project if needed, upgrade tier if applicable.

### P1 — known unapplied work
2. **Phase 16 migration not applied** on `hkyjxdmkqkydnrafhpgn`. File: `vercel-web/supabase/migrations/20260526160000_phase16_ledger_rpc_views.sql`. Verify after running:

   ```sql
   select proname from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('hh_duty_days_link_receipt',
                     'hh_duty_days_unlink_receipt',
                     'hominal_save_receipt',
                     'hominal_soft_delete_receipt')
   order by proname;
   ```

3. **Sentry DSN missing** on Vercel — health flag confirms `monitoring.sentry: false`. Set `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel project env, then redeploy.

4. **OpenAI / WhatsApp env vars missing** on Vercel — health flags both `false`. Re-add `OPENAI_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` if those integrations are in use.

5. **Phases 11–16 changes are now committed locally** as `b3a22bc` (52 files, +8 458 / −736). The branch `cursor/fix-service-open` is **11 commits ahead** of `origin/cursor/fix-service-open` (includes the earlier `21bc33b`). HTTPS push from the agent fails (`Device not configured`) — push from **GitHub Desktop** in one click.

### P2 — deferred manual ops (not in repo)
6. Supabase Auth → enable **leaked password protection** (HIBP).
7. Supabase → enable **daily backups / PITR** on Pro tier.
8. Run `vercel-web/QA_SIGNOFF.md` checklist (Admin + restricted role) and have business owner sign.

### P3 — polish
9. Playwright `critical-flow.spec.ts` needs `E2E_EMAIL` / `E2E_PASSWORD` to run signed-in flows in CI.
10. Remove the 1000-row patient query from `vercel-web/public/legacy-crm.html` (currently page-local filter only).

---

## 5 — What is good and durable

- 527 / 527 unit + integration tests on the critical money paths (billing, payout, inquiry conversion, attendance, payroll rules, RBAC matrix, observability).
- Single deploy path (`vercel-web/`), production root is the React shell — the May-18 audit's #1 risk (legacy iframe as production homepage) is fully closed.
- `hh_duty_days` ledger exists in production with backfill; the only thing left for the Phase 16 RPC is the atomicity guarantee at the DB level. The defensive parallel sync in `billingService` keeps the ledger correct in the meantime.
- All status/close/reopen flows go through dedicated endpoints (no `status` leaks via generic PATCH).
- CSP, HMAC webhook, idempotency table, upload blocklist all shipped and tested.
- Reports no longer sample ≤100 rows — period totals come from server with `count='exact'`.
- Sentry hooks, `instrumentation.ts`, `app/global-error.tsx`, `OPS.md`, and `QA_SIGNOFF.md` all in repo.

---

## 6 — Honest verdict

| Statement | True now? |
|---|---|
| Code is enterprise-ready | **Yes** (~86/100, ~94 after manual steps) |
| Production HTTP layer is up | **Yes** (root + login responding in <2 s) |
| Production database is reachable | **No** (`deps.supabase.ok: false`) |
| Observability is wired in production | **No** (`monitoring.sentry: false`) |
| All declared migrations applied on prod | **No** (Phase 16 pending) |
| Latest code committed | **Yes** — `b3a22bc` ("Phases 11–16: hh_duty_days ledger…") on `cursor/fix-service-open` |
| Latest code pushed to origin | **No** — branch is 11 commits ahead of `origin/cursor/fix-service-open`; push via GitHub Desktop |

**Final score: 86 / 100 (code) — production has live degradations that must be addressed before any business sign-off.**

The 100/100 in the previous readiness document was aspirational, not measured. Reaching it for real requires: recovering Supabase connectivity, applying Phase 16 SQL, setting Sentry/OpenAI/WhatsApp env vars on Vercel, redeploying, then running `QA_SIGNOFF.md` with the business owner.

---

## 7 — Suggested next 60 minutes (operator)

### A. Git (1 click in GitHub Desktop)
- Phases 11–16 are now committed on `cursor/fix-service-open` as `b3a22bc` (the local branch is **11 commits ahead** of `origin/cursor/fix-service-open`).
- **Open GitHub Desktop → repository "bhavin" → Push origin.** From the agent shell, push fails with `Device not configured` because credentials aren't available; GitHub Desktop has your token.
- If you want a PR back into the production branch, open one from GitHub Desktop afterwards.

### B. Supabase database — currently down for queries
Verified at 12:57 UTC:
- Control-plane (`get_project`) responds: project status `ACTIVE_HEALTHY`.
- SQL plane: every `execute_sql` / `apply_migration` / `list_migrations` MCP call times out (~30 s) for the full duration of this audit (~30 min).
- PostgREST root responds with 401 in ~400 ms, but actual table queries (e.g. `GET /rest/v1/hh_users`) hang for 15 s.
- Production `/api/v1/health` answers in 20 s with `deps.supabase.ok: false, error: "unavailable"`.

**This is a Supabase project pooler/Postgres issue, not a config issue.** Operator action:
1. Supabase dashboard → Database → Connection Pooler → verify status and restart if available.
2. If on free tier, check if the project was auto-paused for inactivity.
3. Check Supabase status page (status.supabase.com) for `ap-northeast-1` incidents.
4. As a fallback, rotate `SUPABASE_SERVICE_ROLE_KEY` and update Vercel + redeploy.

Once SQL queries respond:
- Paste `vercel-web/supabase/migrations/20260526160000_phase16_ledger_rpc_views.sql` into SQL Editor and run.
- Verify with: `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('hh_duty_days_link_receipt','hominal_save_receipt','hominal_soft_delete_receipt') order by proname;` — expect 3 rows.

### C. Vercel env vars — currently missing
Verified by `vercel env ls production`:
- ✅ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` set
- ❌ `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` — none set → health `monitoring.sentry: false`
- ❌ `OPENAI_API_KEY` — not set → health `deps.openai: false`
- ❌ `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — not set → health `deps.whatsapp: false`

For each missing var:
```bash
cd vercel-web
npx vercel env add SENTRY_DSN production
# paste value when prompted; repeat for the others
npx vercel deploy --prod --yes
```

### D. Business sign-off
- Run `vercel-web/QA_SIGNOFF.md` as Admin and a restricted role once A–C are done.
- Live score moves from ~86 → ~94 once Supabase is up + Phase 16 SQL applied + Sentry DSN set, and to the full 100 when QA_SIGNOFF is countersigned.
