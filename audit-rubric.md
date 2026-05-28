# Hominal CRM — Enterprise QA Audit Rubric (FROZEN)

Source of truth: `HOMINAL_CRM_ENTERPRISE_QA_AUDIT_2026-05-28.md`.

One row per finding. The pass/fail check is the single observable that closes the finding.
Score = `(checks passing / total checks)`. Computed by the test suite, never by LLM judgment.
Do not edit IDs, severity, or location — only the test that validates the check may evolve.

Total rows: 45 (7 P0 + 38 P1).

| ID | Sev | Location | Pass check |
|---|---|---|---|
| P0-1 | P0 | `vercel-web/public/legacy-crm.html:4254,4257,7489,16247,16306,16308` | File contains zero occurrences of the literal `admin123`. |
| P0-2 | P0 | DB RPCs: `hominal_delete_invoice`, `hominal_flip_billing_status`, `hominal_soft_delete_receipt`, `hominal_save_receipt`, `hh_recompute_payout`, `hh_compact_invoice_seq`, `hh_convert_inquiry_to_patient` | Each function body starts with a `_hh_require_role(array[...])` call (or equivalent `hh_has_role(...)` guard) using the role list from Appendix A. |
| P0-3 | P0 | `vercel-web/lib/api-client.js` + `vercel-web/lib/api/idempotency.ts:29` | Client sets `Idempotency-Key` on every non-GET request, AND server `withIdempotency` synthesizes a key from actor+route+body-hash when the header is absent. |
| P0-4 | P0 | `vercel-web/app/api/v1/cron/duties-extend/route.ts:36-62` | Route returns 401 when `CRON_SECRET` / `DUTY_CRON_SECRET` are unset, regardless of `VERCEL_ENV`; only `Authorization: Bearer` is accepted. |
| P0-5 | P0 | `vercel-web/src/services/patientService.ts:352-396` | `patientService.remove` invokes a single `hominal_close_patient(p_patient_id, p_actor, p_reason)` RPC that, in one transaction, flips status, closes the active bill, and caps all linked active duties. |
| P0-6 | P0 | `vercel-web/src/validation/commonValidation.ts:30` + every repository `q` handler (`payoutRepository.ts:200,329-330,415-417`, `dutyService.ts:547`, patient/billing/employee/inquiry/attendance/vendor/doctor/user repositories) | `idSchema` is `z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/)` AND every repo `q` handler strips `%`, `,`, `(`, `)` and caps length at 200 (or uses `.textSearch()`). |
| P0-7 | P0 | `vercel-web/app/api/v1/uploads/signed-download/route.ts:16-20` + `vercel-web/src/services/storageService.ts:55` | Route handler calls `requireRole(actor, ["Admin","Manager","Accountant","Staff","Executive","Nurse"])`; `expires_in` schema is `max(1800)` with default `300`; role comparison is case-normalised. |
| P1-1 | P1 | `vercel-web/hooks/use-realtime-resource.js:73-91` | `fetchOnce` short-circuits before every `setData/setTotal/setError` when the outer effect's cancellation flag (or `AbortController.signal.aborted`) is true. |
| P1-2 | P1 | `vercel-web/app/payouts/payouts-inner.js:237-281` | `openPayout` captures a request token at entry and every `setDetail/setPayForm/setAdvanceForm/setAdjustForm` is guarded by `if (reqId !== openPayoutSeq.current) return;`. |
| P1-3 | P1 | `vercel-web/lib/api-client.js:98-109` + `vercel-web/components/providers/auth-provider.js:49-95` | `auth-provider.js` registers `window` `online` and `visibilitychange` listeners that call `flushOfflineQueue`, AND `requestWithOfflineFallback` enqueues on 5xx and fetch reject (with retry cap). |
| P1-4 | P1 | FKs `hh_receipts.billing_id`, `hh_invoices.billing_id`, `hh_svc_entries.billing_id`, `hh_attendance.duty_id` | All four FKs are `ON DELETE RESTRICT` (no `CASCADE`). |
| P1-5 | P1 | `vercel-web/app/employees/page.js:936-967,944-949`; `vercel-web/app/patients/page.js:727-746,849-852`; `vercel-web/app/doctors/page.js:215,247`; `vercel-web/app/inquiries/page.js:457-461`; `vercel-web/app/users/page.js:276-280` | Aadhar inputs use `pattern="\d{12}" maxLength={12} inputMode="numeric"`; PAN inputs use `pattern="[A-Z]{5}[0-9]{4}[A-Z]"`; phone inputs use `type="tel" inputMode="tel"`; DOB inputs use `max={todayIso}`. |
| P1-6 | P1 | `vercel-web/app/layout.js:1-21` | File exports `viewport` with at least `width: "device-width"` and `initialScale: 1`. |
| P1-7 | P1 | `vercel-web/public/legacy-crm.html:7419-7421,7449-7452,7711,7787,7897,8070-8077,8169,12217-12250` | Every cited table-row render goes through `safeText()` (or DOM API) — no `innerHTML` concatenation of user-controlled fields remains. |
| P1-8 | P1 | `vercel-web/next.config.mjs:36` (and production response header) | CSP `script-src` directive does NOT contain `'unsafe-eval'`. |
| P1-9 | P1 | `vercel-web/app/api/v1/cron/duties-extend/route.ts:58-62` | Cron path uses a real service-account JWT (non-empty `accessToken`) OR the bypass is documented and a regression test asserts no per-user reasoning depends on `cron@hominal.system`. |
| P1-10 | P1 | `vercel-web/lib/api/security.ts:23-39` | Rate limiter persists state across cold starts (Vercel KV / Upstash) AND a server-side `/api/v1/auth/login` proxy applies `enforceRateLimit(req, "login", 5, 60_000)`. |
| P1-11 | P1 | RPC `public.hh_recompute_payout(p_employee_id, p_period)` | Function body contains either `for update` on the `hh_payouts` row OR `pg_advisory_xact_lock(hashtext('payout:'||$1||':'||$2))` at the top. |
| P1-12 | P1 | RPC `public.hh_convert_inquiry_to_patient(p_inquiry_id)` | Function body contains `for update` on the `hh_inquiries` row AND patient id is derived from a sequence or `gen_random_uuid()` (no `random()` literal). |
| P1-13 | P1 | Schema columns `hh_billings.status`, `hh_payouts.status` | Both columns are `NOT NULL` AND have a `CHECK` constraint restricting values to (`'Active','Closed','Cancelled'`) and (`'OPEN','APPROVED','PAID','CANCELLED'`) respectively. |
| P1-14 | P1 | RPC `public.hh_lookup_login(login_input text)` | Function returns a single boolean column AND `EXECUTE` is revoked from `authenticated` (or otherwise restricted to `service_role`). |
| P1-15 | P1 | `vercel-web/app/api/v1/whatsapp/send/route.ts:12`, `send-bill/route.ts`, `send-template/route.ts` + `vercel-web/src/validation/whatsappValidation.ts:23` | All three routes call `requireRole(actor, ["Admin","Manager"])`; `to` is validated against an env-configured country prefix; `invoice_url` is validated against an org-owned host allow-list. |
| P1-16 | P1 | `vercel-web/app/api/v1/duties/extend-active/route.ts:21` | Route calls `requireRole(actor, ["Admin","Manager"])` AND enforces an idempotency window of ≥ 1 h on repeat invocations. |
| P1-17 | P1 | `vercel-web/app/payouts/payouts-inner.js:1327-1335` | Ensure-payout `period_month` input is `type="month"` and submission rejects values not matching `/^\d{4}-(0[1-9]|1[0-2])$/`. |
| P1-18 | P1 | `vercel-web/src/services/billingService.ts:1556-1681` | `billingService.recordPayment` invokes a single `hominal_save_receipt_v2(p_receipt jsonb)` RPC that allocates `receipt_no`, writes the row, recomputes `paid_status`, and links duty_days atomically; no `nextReceiptNoRpc` fallback writes a null-numbered receipt. |
| P1-19 | P1 | `vercel-web/src/services/billingService.ts:1487-1522,1397-1406` | `billingService.generateFromDutyRange` invokes a single `hominal_generate_from_duty_range(p_billing_id, p_duty_ids, p_actor)` RPC that inserts svc rows and updates duty.billing_id in one transaction. |
| P1-20 | P1 | `vercel-web/app/duties/page.js:476-484` | End-of-month upper bound is built with the IST offset (`+05:30`) or via the shared IST helper — never `toISOString()` of a local end-of-month. |
| P1-21 | P1 | `vercel-web/src/business/employeeRules.ts:41,339`; `vercel-web/src/services/employeeService.ts:514`; `vercel-web/src/services/userService.ts:116`; `vercel-web/src/services/storageService.ts:71`; `vercel-web/src/services/aiService.ts:58` | Each cited site uses `crmTodayIso()` — zero occurrences of `new Date().toISOString().slice(0,10)` remain in `src/`. |
| P1-22 | P1 | `vercel-web/src/services/userService.ts:62-64` | Service rejects a request that would set `role = "Admin"` when the actor's role is not `"Admin"` (Manager cannot mint Admins). |
| P1-23 | P1 | `vercel-web/src/services/inquiryService.ts:489`; `vercel-web/src/services/userService.ts:116`; legacy sync paths in patient/employee | `created` (and `created_by` where applicable) is assigned server-side and stripped from client input — body-supplied values are ignored. |
| P1-24 | P1 | `vercel-web/app/api/v1/whatsapp/webhook/route.ts:55-78` | Route validates the payload with `whatsappWebhookPayloadSchema` (zod) before any `whatsappService.recordWebhook` persist. |
| P1-25 | P1 | `vercel-web/src/services/dutyService.ts:472-498` + billing list/ledger paths | Bill/payout listings use batched `listSvcByBillingIds` / `listActiveReceiptsByBillingIds` — no per-row `await listSvc(b.id)` loop remains. |
| P1-26 | P1 | `vercel-web/src/validation/commonValidation.ts:32` | `isoDate` schema is `z.string().regex(/^\d{4}-\d{2}-\d{2}(T.+)?$/)`. |
| P1-27 | P1 | `vercel-web/app/billings/page.js:194-220`; `vercel-web/app/payouts/payouts-inner.js:283-302`; `vercel-web/app/duties/page.js:518-578`; `vercel-web/app/attendance/page.js:140-160` | Each realtime `useEffect` deps array references `auth.session?.access_token` (string), not the full `auth.session` object. |
| P1-28 | P1 | `vercel-web/app/billings/page.js:140`; `vercel-web/app/payouts/payouts-inner.js:135`; `vercel-web/app/duties/page.js:478` | Each page renders a `Showing first N of M — refine filters` banner when `rows.length === limit`, OR migrates to `usePaginatedResource`. |
| P1-29 | P1 | `vercel-web/app/payouts/payouts-inner.js:584-617` | Code calls `URL.revokeObjectURL(prev)` before overwriting the stored proof URL AND a `useEffect` cleanup revokes on unmount. |
| P1-30 | P1 | `vercel-web/app/globals.css:544-554` | `.modal-card` declares both `max-height: calc(100vh - 48px)` and `overflow-y: auto`. |
| P1-31 | P1 | `vercel-web/app/**/page.js` form labels | Every `<label>` in `vercel-web/app/**/page.js` has an `htmlFor` matching the input's `id`. |
| P1-32 | P1 | `vercel-web/app/employees/page.js:686` (`openEmployeePdf`); `vercel-web/app/patients/page.js:603` (`openPatientPdf`) | Handler calls `window.open("about:blank", "_blank")` synchronously at click time, then writes into the returned window after the awaited signed URL resolves. |
| P1-33 | P1 | `vercel-web/app/api/v1/duties/diary/batch/route.ts`, `…/duties/[id]/route.ts`, `…/inquiries/[id]/convert/route.ts`, `…/billings/[id]/receipts/[receiptId]/route.ts`, `…/duties/[id]/diary/[date]/route.ts` | No cited route calls `parseJsonBody(req).catch(() => ({}))` — malformed bodies propagate as 400. |
| P1-34 | P1 | `vercel-web/lib/api/handler.ts:63` | Routes requiring a body throw `badRequest("Body required")` on empty input; empty-body POSTs to those routes return 400, not 200. |
| P1-35 | P1 | `vercel-web/src/services/storageService.ts:90-109` (`createSignedUpload`) | Input schema includes `mime: z.enum([...allow-list])`, the mime is passed to `createSignedUploadUrl`, AND the storage bucket has a `max_size` policy configured. |
| P1-36 | P1 | `vercel-web/src/services/storageService.ts:60-67,127` | `createSignedUpload` validates the requested object path via `isSafeObjectPath` AND enforces a per-resource prefix policy (e.g. `Patients/<patient_id>/`). |
| P1-37 | P1 | `vercel-web/lib/api/auth.ts:38-43` | Email lookup uses `.eq("email", email.toLowerCase())` — no `.ilike` against the email column remains. |
| P1-38 | P1 | `vercel-web/components/providers/auth-provider.js:115` | Login flows through a server-side `/api/v1/auth/login` proxy that applies `enforceRateLimit(req, "login", 5, 60_000)` (browser no longer calls `supabase.auth.signInWithPassword` directly). |

---

## Scoring rules (frozen)

1. Each row above is one check. A check is `passing` only when its regression test (which must fail before the fix and pass after) is green.
2. P2/P3 findings are tracked in the audit but are NOT part of this rubric — they do not affect the score.
3. Score = `passing_checks / 45` × 100, computed by the test suite. No re-scoring by LLM judgment.
4. To close a finding: one commit, finding ID in the message (e.g. `P1-7:`), one regression test demonstrating fail→pass.
5. DB migrations preserve existing function bodies — never `CREATE OR REPLACE` blind. Apply on a Supabase branch first.
6. Client-side dependencies (e.g. P0-3, P1-38) ship in the same commit as the server change.
