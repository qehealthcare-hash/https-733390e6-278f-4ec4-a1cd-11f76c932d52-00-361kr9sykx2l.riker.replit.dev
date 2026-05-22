# Service Layer (`src/services/`)

Thin orchestration layer that composes validation, business, and database into
`ApiResult<T>`-returning use cases.

## Contract

Every exported function MUST:

1. Accept already-resolved input (no `NextRequest`, no `params`).
2. Call `parseInput(schema, raw)` from `@/validation/parseValidation` before any side effect.
3. Call business rules (`@/business/*`) for calculations or domain checks.
4. Call repositories (`@/database/*`) for persistence — never `supabase.from(...)` directly.
5. Return `ApiResult<T>` from `@/types/common`. Never throw on expected failures.
6. Audit every mutation via `writeMutationAudit` / `finalizeWithAudit` (`mutationAudit.ts`). API success is withheld when audit insert fails (503 `audit_write_failed`).
7. Refetch the persisted row after every mutation so callers can refresh state.

## Implemented

- `employeeService` — create / update / list / getById / setStatus / activate /
  deactivate / remove (soft + hard) / linkCounts.
- `dutyService` — list / getById / create / update / cancel (soft-delete) /
  checkIn / checkOut. Enforces employee + patient overlap detection, rolls back
  billing service-entries on cancel, recomputes payout after cancel and
  checkout. See test matrix below.
- `attendanceService` — list / getById / create / update / mark (upsert) /
  markPresent / markAbsent / remove / listMissingForEmployee. Enforces
  status-based time clamping, duplicate detection (duty or employee+date),
  payout recompute for the row's YYYY-MM (and the prior month when an edit
  crosses periods), and audit logs every mutation.
- `billingService` — list / listByPatient / getById / create / update /
  setStatus / close / reopen / generateFromDuty / generateFromDutyRange /
  recordPayment / invoicePayload / monthlyServiceTotal. Enforces one Active
  bill per patient, locks Closed/Cancelled bills against edits, requires an
  audited reason on reopen, computes totals server-side via
  `computeBillingTotals`, and surfaces a canonical monthly service total for
  dashboards / reports.
- `payoutService` — list / getById / getByEmployeePeriod / ensure / recompute /
  adjust / lock / reopen / markPaid / recomputeForEmployeePeriod /
  monthlyTotal. Gross / duty_count / hours come from
  `hh_recompute_payout` (which reads `hh_duties` + `hh_attendance`); the
  service applies advance/deduction/bonus overlays via
  `mergePayoutAdjustments`, refuses to touch PAID rows, enforces the
  `OPEN → LOCKED → PAID` state machine (with audited reopen), and surfaces
  a per-patient breakdown derived from duty + attendance for UI/report use.
- `reportService` — dashboard / billingTotals / payoutTotals / profitLoss /
  payroll. All KPIs and totals are computed server-side from `hh_*` tables
  via `reportRepository` + `reportRules.build*`; supports `period` (YYYY-MM),
  explicit `from`/`to` ISO ranges, and `patient_id` / `employee_id` /
  `status` filters. The dashboard widget and the records page MUST call the
  same endpoints to stay in sync — never query Supabase directly from the
  client for aggregates.
- `inquiryService` — list / getById / create / update / setStatus / convert /
  remove. Phone, status, follow-up date are validated server-side
  (`FollowUp` / `Negotiating` require a follow-up date). Duplicate active
  inquiries are blocked at both service-layer (`findOpenInquiryDuplicate`)
  and DB-layer (`uq_hh_inquiries_active_phone`). Convert is idempotent and
  attaches to an existing patient (matched by phone) via the
  `hh_convert_inquiry_to_patient` RPC. Converted inquiries are terminal —
  editing them is refused. Every mutation refetches the row and writes an
  audit log.
- `patientService` — list / getById / create / update / remove (soft-close) /
  assignCaretaker / history. Validates name + mobile + location fields;
  blocks duplicate Active patients by phone suffix; refuses edits on Closed
  patients; caretaker assignment checks employee exists; history bundle
  (billings / duties / receipts / audits) is assembled entirely from DB.

## Phase 5 complete

All CRM domain modules now have a layered service under `src/services/`.
Legacy `lib/api/services/*.service.ts` files are `@deprecated` shims that
delegate to the new services via `apiResultBridge.unwrap`. API routes under
`app/api/v1/*` should import from `@/services/*` directly.

## Phase 6 complete — response envelope

Every `/api/v1/*` route returns:

```json
{ "success": true, "data": { } }
```

or on failure:

```json
{ "success": false, "error": "…", "code": "…", "details": { } }
```

- Route handlers use `respond(result)` from `@/lib/api/apiResultBridge`.
- Thrown errors (`ApiError`, Zod) are caught by `withAuth` → `jsonError` (same shape).
- `lib/api-client.js` unwraps `success` / `data` / `error` for React pages.
- See `vercel-web/docs/API_ENVELOPE.md` for the full contract.

## Test matrix — `dutyService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Assign duty with valid patient + employee + shift | Returns row, status `SCHEDULED`, audit `create` written | `POST /api/v1/duties` → `dutyService.create` |
| Assign duty overlapping same employee | 409 with `code: duplicate`, `details.field: "employee_window"` | `ensureNoOverlap` (employee branch) |
| Assign duty overlapping same patient | 409 with `code: duplicate`, `details.field: "patient_window"` | `ensureNoOverlap` (patient branch) |
| Edit duty start/end inside window | Updates + writes audit `update` | `PATCH /api/v1/duties/[id]` |
| Edit a `COMPLETED` duty back to `SCHEDULED` | 422, `code: business_rule_violation` | `canReopenCompletedDuty` |
| Cancel a duty with no billing | Status `CANCELLED`, audit `delete`, payout recomputed | `POST /api/v1/duties/[id]/cancel` |
| Cancel a duty whose billing already has receipts | 409, refuses to corrupt finance data | `canCancelDutyWithBilling` |
| Cancel a duty whose billing has only service entries | Service entries deleted, status `CANCELLED` | `rollbackBillingFromDuty` |
| Check-in duty | Attendance upserted, duty `IN_PROGRESS` | `POST /api/v1/duties/[id]/check-in` |
| Check-out without prior check-in | 400 `bad_request` | `dutyService.checkOut` |
| Check-out with check-in | Hours computed, duty `COMPLETED`, payout recomputed for duty's month | `dutyService.checkOut` |
| Refresh page after each mutation | All routes refetch from DB and return the persisted row so the client just re-renders | `loadFreshDuty` |

## Test matrix — `attendanceService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Mark Present (no existing row) | New row created, status `PRESENT`, `hours` populated, payout recomputed | `POST /api/v1/attendance/mark` → `attendanceService.mark` → `create` |
| Mark Present twice for same duty | Second call updates the existing row, no duplicate created | `attendanceService.mark` upsert branch |
| Mark Absent | New row, `check_in_at` / `check_out_at` = null, `hours` = 0, payout recomputed | `attendanceService.markAbsent` |
| Create with status `PRESENT` but no check-in / no duty | 422 `business_rule_violation` ("PRESENT/LATE/HALF_DAY attendance needs check_in_at or duty_id") | `ensureAttendanceHasAnchor` |
| Create with `check_out_at <= check_in_at` | 422 `validation_error` | Zod cross-field guard |
| Create with `status: ABSENT` but `check_out_at` set | 422 `validation_error` | Zod cross-field guard |
| POST duplicate attendance for same `duty_id` | 409 `duplicate` with `details.field: "duty_id"` | `checkDuplicate` + UQ constraint surfacing |
| POST second attendance for same `employee_id` + same calendar date (no duty) | 409 `duplicate` with `details.field: "employee_date"` | `checkDuplicate` date branch |
| Edit attendance hours | Updates row, recomputes payout for new period, also recomputes prior period if it changed | `attendanceService.update` |
| Delete attendance | Row removed, payout recomputed for its period, audit `delete` written | `attendanceService.remove` |
| `GET /api/v1/attendance/missing?employee_id=&from=&to=` | Returns duties without an attendance row (skipping CANCELLED / NO_SHOW) | `attendanceService.listMissingForEmployee` |
| Refresh page after each mutation | Routes return the refetched persisted row so the client just re-renders | `loadFreshAttendance` |

## Test matrix — `billingService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Generate bill from a duty (first time) | New Active bill created for the patient (or existing one used), service entry inserted, `duty.billing_id` linked, totals server-computed | `POST /api/v1/billings/generate` → `generateFromDuty` |
| Generate the same duty again | Returns existing svc entry with `duplicate: true` — no second row | `findSvcByDutyRemark` idempotency branch |
| Generate from a duty whose linked bill is Closed | 422 `business_rule_violation`: "reopen it before re-billing" | `canBillDuty` |
| Generate from CANCELLED / NO_SHOW duty | 422 with shift status detail | `canBillDuty` |
| Generate bill with `period` that doesn't match `duty.start_at` | 400 `bad_request` with `details.requested` vs `details.duty_period` | `dutyInPeriod` |
| Bulk-bill a YYYY-MM range twice | Second call reports `created: 0`, only new duties counted | `generateFromDutyRange` idempotency |
| Patient already has an Active bill, second POST `/billings` | Returns the existing Active row (no duplicate) | `ensureActiveBilling` + `uq_hh_billings_patient_active` |
| Edit `sec_dep` / `notes` on Active bill | Persists, returns refetched row, audit `update` | `update` + `canEditBilling` |
| Edit on Closed bill | 422 `business_rule_violation`: "reopen the bill before editing" | `canEditBilling` |
| Close bill with zero service entries | 422: "Cannot close a bill with no service entries" | `canCloseBilling` |
| Close bill with outstanding > 0 (no force) | 422 with `details.outstanding` | `canCloseBilling` |
| Close bill with `force: true` | Persists, status `Closed`, totals returned | `canCloseBilling` force branch |
| Record receipt on Closed bill | 422: bill locked | `recordPayment` → `canEditBilling` |
| Reopen a Closed bill with no reason | 422 `validation_error` (reason required) | Zod `billingReopenSchema` |
| Reopen a Closed bill while another Active bill exists for the same patient | 409 `duplicate`: "Patient already has another Active bill" | `reopen` pre-check |
| Reopen a Closed bill with reason + no conflicting Active bill | Status `Active`, audit `update` with reason, refetched bundle returned | `reopen` |
| `GET /api/v1/billings/totals?period=YYYY-MM` | Sum equals sum of `BillingWithTotals.totals.services` across that month — dashboards match invoice screen | `monthlyServiceTotal` |
| Refresh page after each mutation | All routes return the persisted row + totals so the client just re-renders | `loadBundleWithTotals` |

## Test matrix — `payoutService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| `POST /api/v1/payouts` with valid employee + period | Calls `hh_recompute_payout`, persists row, applies any advance/deduction/bonus, audit `create` (or `update` if row existed) | `payoutService.ensure` |
| `POST /api/v1/payouts` twice for same `(employee_id, period_month)` | Idempotent — second call updates the same row (DB `hh_payouts_unique`), no duplicate created | `findByEmployeePeriod` + `recomputeAndPersist` |
| `POST /api/v1/payouts/adjust` on OPEN payout | Updates advance/deduction/bonus/remarks, `net_amount` recomputed server-side, audit `update` | `payoutService.adjust` |
| `POST /api/v1/payouts/adjust` on LOCKED payout | 422 `business_rule_violation`: "Payout is LOCKED — reopen before adjusting" | `canEditPayout` |
| `POST /api/v1/payouts/adjust` on PAID payout | 422: "Cannot adjust a PAID payout" | `canEditPayout` |
| `POST /api/v1/payouts/adjust` with advance + deduction > gross + bonus | 422: "Advance + deduction exceeds gross + bonus" | `validatePayoutAmounts` |
| `POST /api/v1/payouts/[id]/lock` on OPEN payout with duties + amount | Status `LOCKED`, audit `update` with reason | `canLockPayout` + `payoutLockRow` |
| `POST /api/v1/payouts/[id]/lock` on empty (zero-duty, zero-net) payout | 422: "Cannot lock an empty payout" | `canLockPayout` |
| `POST /api/v1/payouts/[id]/lock` on PAID payout | 422: "Cannot lock a PAID payout" | `canLockPayout` |
| `POST /api/v1/payouts/[id]/reopen` on LOCKED with reason | Status `OPEN`, audit `update` with reason | `canReopenPayout` + `payoutReopenRow` |
| `POST /api/v1/payouts/[id]/reopen` without reason | 422 `validation_error` (reason required) | Zod `payoutReopenSchema` |
| `POST /api/v1/payouts/[id]/reopen` on OPEN or PAID | 422: "Only LOCKED payouts can be reopened" | `canReopenPayout` |
| `POST /api/v1/payouts/[id]/recompute` on OPEN/LOCKED | Re-runs RPC, refreshes gross/hours/duty_count, audit `update` | `payoutService.recompute` |
| `POST /api/v1/payouts/[id]/recompute` on PAID | 422: "Cannot recompute a PAID payout" | `payoutService.recompute` |
| `POST /api/v1/payouts/[id]/recompute` for period with no duties | 422 with `code: business_rule_violation`: "No duty / attendance records" | `ensurePayoutHasSource` |
| `POST /api/v1/payouts/pay` first time | Status `PAID`, `paid_at` stamped, paid transaction upserted | `payoutService.markPaid` |
| `POST /api/v1/payouts/pay` second time | 422: "Payout already paid" | `canMarkPayoutPaid` |
| Duty cancelled / checked-out / attendance edited | `payoutRepository.recomputeRpc` runs automatically — payout reflects the latest duty + attendance totals | duty + attendance services |
| `GET /api/v1/payouts/[id]` | Returns `{ payout, duties, attendance, breakdown }` — per-patient duty count + hours derived from the source data | `payoutService.getById` + `breakdownByPatient` |
| `GET /api/v1/payouts/totals?period=YYYY-MM` | Sum of `net_amount` across all payouts in that month — matches the table view | `payoutService.monthlyTotal` |
| Refresh page after each mutation | Routes return the persisted row so the client just re-renders | `loadFreshPayout` |

## Test matrix — `reportService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| `GET /api/v1/reports/dashboard` (no params) | KPIs for current UTC month: `patients_total`, `patients_active`, `employees_total`, `employees_active`, `inquiries_this_month`, `duties_active/scheduled/completed/cancelled`, `billings_total/open/closed`, `billing_total_amount` / `_collected` / `_pending`, `payout_total` / `_gross` / `_paid` / `_pending`, `profit_loss` | `dashboard` → `buildDashboardKpis` |
| `GET /reports/dashboard?period=2026-04` | Same KPIs scoped to April 2026 | `resolveWindow` (period branch) |
| `GET /reports/dashboard?from=…&to=…` | Range-window KPIs (overrides period) | `resolveWindow` (custom range branch) |
| `GET /reports/dashboard?patient_id=…` | Patient-scoped billing + duty counters; global counters unchanged | `reportRepository.countDutiesInRange` + `listBillingsInRange` |
| `GET /reports/dashboard?employee_id=…` | Employee-scoped duty + payout counters | `reportRepository.listPayoutsForPeriod` |
| Dashboard `billing_total_amount` equals sum of `hh_svc_entries.total` for the window | UI value equals direct Supabase aggregate | `reportRepository.listServicesInRange` + `sumServiceTotals` |
| Dashboard `billing_collected_amount` equals sum of non-deleted `hh_receipts.amount` in window | UI value equals direct Supabase aggregate | `reportRepository.listReceiptsInRange` (`.is('deleted_at', null)`) + `sumReceiptAmounts` |
| Dashboard `payout_total_amount` equals sum of `hh_payouts.net_amount` for the period | UI value equals direct Supabase aggregate | `reportRepository.listPayoutsForPeriod` |
| Dashboard `payout_paid_amount` = sum of `net_amount` where `status = 'PAID'` | Matches the payouts page filtered to PAID | `buildDashboardKpis` PAID filter |
| Dashboard `payout_pending_amount` = `payout_total − payout_paid` (never negative) | Matches `payoutOutstanding` | `buildDashboardKpis` |
| Dashboard `profit_loss` = `billing_collected − payout_paid` | Matches `GET /reports/profit-loss` | `buildDashboardKpis` |
| `GET /reports/billing-totals?period=YYYY-MM` | `{ billings_count, service_total, collected, pending, byStatus }` | `billingTotals` |
| `GET /reports/payout-totals?period=YYYY-MM` | `{ rows_count, gross, net, paid, pending, advance, deduction, bonus }` | `payoutTotals` |
| `GET /reports/payout-totals?period=…&employee_id=…` | Same totals scoped to one employee | repository filter |
| `GET /reports/profit-loss?period=YYYY-MM` | `{ revenue, payouts_paid, payouts_pending, net_profit, net_profit_after_pending_payouts }` | `profitLoss` |
| `GET /reports/payroll?period=YYYY-MM` | Per-employee payout rows + attendance rollup + grand totals | `payroll` |
| Apply filter, refresh page | Numbers match because the service is the only source — frontend cannot drift | `reportService.*` (no client-side aggregation) |

## Test matrix — `inquiryService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| `POST /api/v1/inquiries` with valid name + phone + status="New" | Row inserted, audit `create` written, returns API-shape inquiry | `inquiryService.create` |
| `POST /inquiries` with status="FollowUp" but no `followup_date` | 422 `validation_error` ("followup_date is required when status is FollowUp") | Zod cross-field guard in `inquirySchema` |
| `POST /inquiries` with status="Negotiating" but no `followup_date` | 422 `validation_error` | Zod cross-field guard |
| `POST /inquiries` with same phone as an existing open inquiry | 409 `duplicate` with `details.field: "phone"` | `ensureNoActiveDuplicate` + `uq_hh_inquiries_active_phone` |
| `POST /inquiries` with same phone as a `Closed`/`Lost` inquiry | Allowed — closed records don't count | `findOpenInquiryDuplicate` (status filter) |
| `POST /inquiries` with `source` in lowercase (`"whatsapp"`) | Normalised to `"WHATSAPP"`, persists | Zod transform → enum |
| `PATCH /inquiries/[id]` to update name / area / service | Row updated, audit `update`, returns refetched API row | `inquiryService.update` |
| `PATCH /inquiries/[id]` with new phone matching another open inquiry | 409 `duplicate` | `ensureNoActiveDuplicate` (excluding `id`) |
| `PATCH /inquiries/[id]` on a `Converted` inquiry | 422 `business_rule_violation`: "Converted inquiries are read-only" | `canEditInquiry` |
| `POST /inquiries/[id]/status` with valid transition | Status updated, follow-up date set, audit `update` | `setStatus` + `canTransitionInquiryTo` |
| `POST /inquiries/[id]/status` Converted → anything | 422 `business_rule_violation`: terminal | `canTransitionInquiryTo` |
| `POST /inquiries/[id]/status` Closed → New without reason | 422: "Reopening a Closed inquiry requires a reason" | `canTransitionInquiryTo` |
| `POST /inquiries/[id]/status` Closed → New with reason and conflicting active inquiry on same phone | 409 `duplicate` | `setStatus` reopen guard |
| `POST /inquiries/[id]/convert` first time, phone matches existing patient | Inquiry status flipped to `Converted`, returns `{ patient_id (existing), inquiry_id, alreadyConverted: false }`, audit `convert` | `convertRpc` (existing-patient branch) |
| `POST /inquiries/[id]/convert` first time, no existing patient | New patient created, inquiry → `Converted`, returns `{ patient_id (new), inquiry_id, alreadyConverted: false }` | `convertRpc` (new-patient branch) |
| `POST /inquiries/[id]/convert` again | Idempotent — returns same `patient_id` with `alreadyConverted: true`, no duplicate row | service idempotency check |
| `POST /inquiries/[id]/convert` on `Closed`/`Lost` inquiry | 422: "Cannot convert a Closed/Lost inquiry — reopen it first" | `canConvertInquiry` |
| `POST /inquiries/[id]/convert` on inquiry with no phone | 422: "Inquiry has no mobile to dedupe" | `canConvertInquiry` |
| `DELETE /inquiries/[id]` on open inquiry | Row removed, audit `delete` | `inquiryService.remove` |
| `DELETE /inquiries/[id]` on Converted inquiry | 422: "Cannot delete a Converted inquiry — close the patient record instead" | `remove` guard |
| `GET /inquiries?open_only=true` | Returns only inquiries with status NOT in `(Converted, Closed, Lost)` | `inquiryRepository.list` `open_only` branch |
| `GET /inquiries?followup_from=…&followup_to=…` | Returns inquiries whose `followup_date` is inside the window | repository `followup_*` filters |
| Refresh page after each mutation | Routes refetch from DB and return the persisted API row so the client just re-renders | `loadFreshInquiry` |

## Test matrix — `patientService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| `POST /api/v1/patients` with valid name + phone | Row inserted, audit `create`, returns API-shape patient | `patientService.create` |
| `POST /patients` with duplicate Active phone | 409 `duplicate` with `details.field: "phone"` | `ensureNoActiveDuplicate` |
| `PATCH /patients/[id]` update area / addr / status | Persists, audit `update`, refetched row returned | `patientService.update` |
| `PATCH /patients/[id]` on Closed patient | 422: "Closed patients are read-only" | `canEditPatient` |
| `PATCH /patients/[id]` with new phone matching another Active patient | 409 `duplicate` | `ensureNoActiveDuplicate` (exclude id) |
| `DELETE /patients/[id]` | Soft-close (`status = Closed`), duties/billings preserved, audit `delete` | `patientService.remove` |
| `POST /patients/[id]/assign` with valid caretaker + shift | `caretaker_id` + `shift` set, employee validated, audit `update` | `assignCaretaker` |
| `POST /patients/[id]/assign` on Closed patient | 422: "Caretaker can only be assigned to an Active patient" | `canAssignCaretaker` |
| `POST /patients/[id]/assign` with unknown employee | 404 `not_found` | `employeeRepository.findById` |
| `GET /patients/[id]/history` | Returns `{ patient, billings, receipts (scoped to billings), duties, audits, linkCounts }` from DB | `patientService.history` |
| Refresh page after each mutation | Routes return persisted API row — no local-only state | `loadFreshPatient` |

## Phase 7 — Legacy SPA migration

Phase 7 cuts the legacy `public/legacy-crm.html` over from direct Supabase
REST to the audited `/api/v1` surface. To keep the offline-first sync layer
working during the cut-over, a single adapter (`public/lib/legacy-api.js`)
exposes `window.legacyApi.<module>` helpers that the SPA prefers; the
existing direct-Supabase paths stay as **transport** fallbacks only.

### Phase 7a — Receipts (complete)

- New routes:
  - `GET  /api/v1/billings/[id]/receipts` → `billingService.listReceiptsForBilling` (returns active rows only, RLS-scoped).
  - `DELETE /api/v1/billings/[id]/receipts/[receiptId]` → `billingService.softDeleteReceipt` (close-bill guard + audit log).
- `receiptSchema` widened to accept the legacy `hh_receipts` column set (`patient_id`, `service_type`, `bill_mode`, `from_date`, `to_date`, `paid_days`, `paid_dates`, …).
- `billingRepository.softDeleteReceiptRpc` wraps `hominal_soft_delete_receipt`.
- Legacy SPA wiring (`legacy-crm.html`):
  - `saveReceiptLedgerRow`         → `legacyApi.receipts.create` first, then RPC fallback.
  - `deleteReceiptLedgerRow`       → `legacyApi.receipts.softDelete` first, then RPC fallback.
  - `refreshBillingReceiptsFromCloud` → `legacyApi.receipts.list` first, then Supabase REST fallback.
- Business rejections (closed bill, RLS, duplicate id) **do not** fall back — they surface to the cashier.
- Tombstones, dirty tracking, and the realtime channel are unchanged.

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Add receipt while bill is Active | `legacyApi.receipts.create` → `hominal_save_receipt`, audit `create` written | `billingService.recordPayment` |
| Add receipt while bill is Closed | API rejects with 422 / `business_rule`; SPA shows toast, does NOT fall back | `canEditBilling` + adapter `transport === "business"` branch |
| Delete receipt while bill is Active | `legacyApi.receipts.softDelete` → `hominal_soft_delete_receipt`, audit `soft-delete` written | `billingService.softDeleteReceipt` |
| Delete receipt while bill is Closed | 422; SPA keeps row visible | `canEditBilling` |
| Network drop mid-save | Adapter returns `transport: "network"`; SPA falls back to direct RPC/upsert | `legacy-api.js request()` |
| API tier 5xx | Same fallback as network drop | `legacy-api.js request()` |
| Refresh after save/delete | `legacyApi.receipts.list` returns canonical active set; tombstones + dirty rows merged locally | `refreshBillingReceiptsFromCloud` |

### Phase 7b — Billings (complete)

- New route: `POST /api/v1/billings/sync` → `billingService.syncLegacy` (legacy upsert with client `INVE…` ids, `Paused`, `close_reason`).
- `BILLING_STATUSES` extended with `Paused`; `billingCloseRow` now persists `close_reason` / `close_reason_other`.
- `legacyApi.billings`: `listByPatient`, `getById`, `create`, `sync`, `update`, `setStatus`, `close`, `reopen`.
- Legacy SPA wiring:
  - `saveBillingLedgerRow` — API sync first, Supabase upsert fallback.
  - `refetchBillingForPatient` — `GET /billings?patient_id=` first.
  - `createBillingForPatient`, `syncBillingSecurityAmount`, `syncBillingStatusChange` — routed through `saveBillingLedgerRow`.
  - `doCloseBill` (modal) — tries `POST /billings/:id/close` first, falls back to sync on transport/outstanding rejection.
- Bulk offline push (`loadFromSupabase` batch `sbUpsert`) still uses direct Supabase — scheduled for a later pass.

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Create billing for patient (`INVE…` id) | `POST /billings/sync` inserts with client id, returns persisted row | `syncLegacy` insert branch |
| Duplicate Active bill for same patient | Returns existing Active row (no duplicate) | `findActiveByPatient` + unique index |
| Update `sec_dep` after Security receipt | `syncLegacy` or `PATCH` updates `sec_dep` even on Closed bill | `syncLegacy` sec-only branch |
| Close bill via modal | `POST /close` with reason; falls back to sync if outstanding blocks close | `doCloseBill` + `billingService.close` |
| Pause bill | `syncLegacy` with `status: Paused` + `pause_reason` | `billingPauseRow` |
| Refresh patient billing view | `GET /billings?patient_id=` bundle → local `DB.billings[patId]` | `refetchBillingForPatient` |

### Phase 7c — Duties / svc-entries / payout-charges (complete)

Two distinct surfaces ship under Phase 7c because the legacy SPA models a
"duty" as both a `hh_svc_entries` row (billable duty diary) and a per-partner
`hh_payout_charges` row, whereas the new architecture also adds the structured
`hh_duties` calendar.

- New routes:
  - `POST /api/v1/billings/svc-entries/replace` → `billingService.replaceServiceEntries` (atomic replace by `svc_key`; refuses on Closed/Cancelled parent bill).
  - `POST /api/v1/payouts/charges/replace` → `payoutService.replacePayoutCharges` (atomic replace by `svc_key`).
- `billingRepository.replaceSvcEntriesRpc` and `payoutRepository.replacePayoutChargesRpc` wrap `hominal_replace_service_entries` / `hominal_replace_payout_charges` and surface row counts.
- `legacyApi`:
  - `legacyApi.svcEntries.replace(svcKey, rows)`
  - `legacyApi.payoutCharges.replace(svcKey, rows)`
  - `legacyApi.duties.{ list, getById, create, update, cancel, checkIn, checkOut }` (covers the new `hh_duties` calendar for Phase 8 React UI; not yet wired into the legacy SPA which has no `hh_duties` flow).
- Legacy SPA wiring:
  - `syncServiceEntriesToSupabase(svcKey)` → API first, RPC fallback.
  - `syncPayoutChargesToSupabase(svcKey)` → API first, RPC fallback.

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Save duty diary on an Active bill | `POST /svc-entries/replace` replaces svc rows, audit `update` written | `billingService.replaceServiceEntries` |
| Save duty diary on a Closed bill | 422 `business_rule_violation`; cashier sees toast, no fallback | `canEditBilling` + adapter `transport === "business"` branch |
| Save duty diary while offline | Adapter returns `transport: "network"`; SPA falls back to direct RPC; offline queue catches up later | `legacy-api.js request()` |
| Update payout-charges slice for a duty row | `POST /payouts/charges/replace` replaces rows, audit `update` written | `payoutService.replacePayoutCharges` |
| Concurrent diary save (same svc_key) | In-flight Promise deduped by `svcSyncInFlight`; only one API call at a time | `syncServiceEntriesToSupabase` |
| `GET /duties` from a React page (Phase 8) | Returns rows from `hh_duties` (new calendar); legacy SPA does not yet consume this surface | `dutyService.list` |

### Phase 7d — Patients (complete)

- New route: `POST /api/v1/patients/sync` → `patientService.syncLegacy` (legacy upsert with client `PID…` ids, legacy status enum, `status_reason`, photo/docs).
- `patientLegacySyncSchema` accepts `Active|Paused|Duty Closed|Expired|Deceased|Discharged|On Hold|Closed`.
- Light refresh paths omit `photo`/`docs` — sync preserves existing JSONB blobs on update.
- `legacyApi.patients`: `list`, `getById`, `history`, `sync`, `assignCaretaker`, `remove`.
- Legacy SPA wiring:
  - `savePatientLedgerRow` — API sync first, Supabase upsert fallback.
  - `refetchPatientsFromCloud` — `GET /patients?limit=500` first.
  - `savePatient`, `startServices`, `syncBillingStatusChange`, `persistRow` patient path — routed through `savePatientLedgerRow`.
- Bulk offline push (`loadFromSupabase` batch `sbUpsert`) still uses direct Supabase.

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Register new patient (`PID…` id) | `POST /patients/sync` inserts with client id | `syncLegacy` insert branch |
| Edit patient name/phone | `POST /patients/sync` updates row, audit `update` | `syncLegacy` update branch |
| Duplicate Active phone | 409 `duplicate`; toast, no fallback | `ensureNoActiveDuplicate` |
| Close bill → patient status `Duty Closed` | `savePatientLedgerRow` persists legacy status | `syncLegacy` |
| Refresh patient list | `GET /patients` → merge with dirty local rows | `refetchPatientsFromCloud` |

### Phase 7e — Employees (complete)

- New route: `POST /api/v1/employees/sync` → `employeeService.syncLegacy` (legacy upsert with client `EMP…` ids, full `toSbEmployee()` column set).
- `employeeLegacySyncSchema` mirrors all legacy DB columns (aadhar, pan, ec*, skills, photo/docs, …).
- Photo/docs omitted on light refresh are preserved on update (same pattern as patients).
- `legacyApi.employees`: `list`, `getById`, `links`, `sync`, `setStatus`, `remove`.
- Legacy SPA wiring:
  - `saveEmployeeLedgerRow` — API sync first, Supabase upsert fallback.
  - `refetchEmployeesFromCloud` — `GET /employees?limit=500` first.
  - `saveEmployee` → `persistRow.toRemote` → `saveEmployeeLedgerRow`.
- Bulk offline push still uses direct Supabase.

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Create employee (`EMP…` id) | `POST /employees/sync` inserts with client id | `syncLegacy` insert branch |
| Edit employee phone/docs | `POST /employees/sync` updates, audit `update` | `syncLegacy` update branch |
| Duplicate Active mobile | 409 `duplicate`; toast, no fallback | `findActiveEmployeeDuplicate` |
| Delete employee with duty links | `DELETE /employees/:id` soft-deactivates | `employeeService.remove` (adapter ready; legacy `safeDelete` still direct for now) |
| Refresh employee list | `GET /employees` → local `DB.employees` | `refetchEmployeesFromCloud` |

### Phase 7f — Inquiries (complete)

- New route: `POST /api/v1/inquiries/sync` → `inquiryService.syncLegacy` (legacy upsert with client `INQ…` ids, `toSbInquiry()` column set).
- `inquiryLegacySyncSchema` accepts legacy source labels (mixed case) and normalises `potential` to `HOT|WARM|COLD`.
- Open-phone duplicate prevention via `ensureNoActiveDuplicate` (same as canonical create/update).
- `legacyApi.inquiries`: `list`, `getById`, `sync`, `setStatus`, `convert`.
- Legacy SPA wiring:
  - `saveInquiryLedgerRow` — API sync first, Supabase upsert fallback on transport errors only.
  - `refetchInquiriesFromCloud` — `GET /inquiries?limit=500` first.
  - `saveInquiry` → `persistRow.toRemote` → `saveInquiryLedgerRow`.
- Bulk offline push and `safeDelete` for inquiries still use direct Supabase.
- `convertInquiry` in the SPA still opens the patient modal (does not call `/inquiries/:id/convert` yet).

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Create inquiry (`INQ…` id) | `POST /inquiries/sync` inserts with client id | `syncLegacy` insert branch |
| Edit inquiry | `POST /inquiries/sync` updates, audit `update` | `syncLegacy` update branch |
| Duplicate active phone | 409 `duplicate`; toast, no fallback | `ensureNoActiveDuplicate` |
| FollowUp without date | 422 validation; no fallback | `inquiryLegacySyncSchema` superRefine |
| Refresh inquiry list | `GET /inquiries` → `DB.inquiries` | `refetchInquiriesFromCloud` |

### Phase 7g — Dashboard & reports (complete)

- `legacyApi.reports`: `dashboard`, `billingTotals`, `payoutTotals`, `profitLoss`, `payroll` (read-only GET wrappers).
- Legacy SPA wiring:
  - `renderDashboard` — renders from local `DB` immediately, then `hydrateDashboardFromApi()` overlays audited KPIs (`patients_total`, `patients_active`, `employees_total`, `billings_total`, `billing_pending_amount`).
  - `buildReportDataWithApi()` — **profit-loss** and **employee-payout** (monthly/yearly) prefer cloud totals; all other report types stay local-only (patient billing, invoice payments, reconciliation, inquiry conversion, attendance).
  - `renderReports` / CSV export / print use `buildReportDataWithApi()`.
- Cash/refund/payout breakdown widgets and recent-patient tables remain local (no API parity).

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Open dashboard (signed in) | KPI tiles refresh from `GET /reports/dashboard` | `hydrateDashboardFromApi` |
| API transport failure | Dashboard still shows local aggregates | `renderDashboardFromLocal` |
| Profit & loss report | Single-period cloud revenue / payout-paid / net | `tryProfitLossReportFromApi` |
| Employee payout (monthly) | Rows from `GET /reports/payroll` | `tryEmployeePayoutReportFromApi` |
| Patient billing report | Still computed from local `DB` | `buildPatientBillingReport` |

### Phase 8 — React shell / retire iframe default (complete)

- **Default entry**: `/` → `/dashboard` (no longer redirects to `legacy-crm.html`).
- **Auth**: `/login` React sign-in (Supabase password); `/legacy` serves the Classic CRM iframe.
- **Navigation**: sidebar modules + “Classic CRM” escape hatch.
- **Permissions**: `hh_users.role` labels (`Admin`, `Manager`, `Staff`, …) normalized for React guards.
- **API wiring**:
  - `useRealtimeResource` unwraps `{ rows, total }` list envelopes.
  - Dashboard → `GET /reports/dashboard`.
  - Reports → `billing-totals`, `payout-totals`, `profit-loss`, `payroll`.
- **New page**: `/duties` — `hh_duties` calendar (create, edit, check-in/out, cancel).
- **Still Classic CRM**: service diary (`hh_svc_entries`), provisional bills, deep billing PDFs, settings, users/roles admin.

| Route | Surface |
| --- | --- |
| `/dashboard` | Audited KPI cards |
| `/patients`, `/inquiries`, `/employees` | React CRUD + realtime |
| `/duties` | New duty calendar API |
| `/billings`, `/payouts` | React modules (partial parity) |
| `/reports` | Server-side aggregates |
| `/legacy` | Full 16k-line legacy SPA |

### Phase 9 — Audit log enforcement (complete)

- **`src/services/mutationAudit.ts`** — `writeMutationAudit` + `finalizeWithAudit`. When `API_AUDIT_DISABLED` is not `true`, mutations return **503** `audit_write_failed` if the audit row cannot be inserted (`details.persisted: true` when the DB change already saved).
- All domain services (`patient`, `employee`, `inquiry`, `billing`, `receipt`, `svc_entry`, `payout`, `duty`, `attendance`) route audits through this helper (~47 mutation paths).
- **`GET /api/v1/audits`** — `auditService.list` with `module`, `entity_id`, `action`, pagination.
- **React** `/audits` — filterable audit viewer + CSV export.
- **`legacyApi.audits.list`** — Classic SPA can load server audit rows after API saves.
- Legacy `recordAudit()` still writes local + optional direct Supabase rows for UI stamps; authoritative trail for API mutations is server-side.

| Scenario | Expected |
| --- | --- |
| `POST /patients` success | Row in `hh_audit_logs` with `action=create` before HTTP 200 |
| Audit insert fails (RLS/DB) | HTTP **503**, `code: audit_write_failed`, `details.persisted: true` |
| `API_AUDIT_DISABLED=true` (CI) | Mutations succeed without audit insert |
| `GET /audits?module=patient&entity_id=PID…` | Newest-first rows for that entity |

### Phase 10 — Test matrix & CI (complete)

- **Runner**: Vitest (`vitest.config.ts`) with path aliases matching `tsconfig.json`.
- **Scripts**: `npm test`, `npm run test:watch`, `npm run typecheck`.
- **CI**: `.github/workflows/vercel-web-ci.yml` — typecheck + unit tests on PR / `main` when `vercel-web/**` changes.
- **Docs**: `docs/TEST_MATRIX.md` maps automated tests → README scenario tables.

| Test file | Covers (from README matrices) |
| --- | --- |
| `inquiryRules.test.ts` | Open/closed predicates, duplicate phone, convert/edit/transition guards |
| `inquiryValidation.test.ts` | FollowUp date required, legacy sync shape |
| `billingRules.test.ts` | Close/reopen/edit, outstanding + force, totals sums |
| `payoutRules.test.ts` | Lock/paid/adjust, transitions, amount validation |
| `reportRules.test.ts` | `buildDashboardKpis`, `buildProfitLoss` |
| `mutationAudit.test.ts` | `writeMutationAudit`, `finalizeWithAudit` (503 path) |

Integration / E2E (Supabase + HTTP + Playwright) remain manual — see `docs/TEST_MATRIX.md`.

### Pending after Phase 10
- Port remaining Classic-only flows into React, then remove iframe.
- Optional: gate `deploy-vercel.yml` on `vercel-web CI` job.

## Forbidden

- Direct `from("hh_…")` queries.
- Business math (use `src/business`).
- HTTP response building (route handlers wrap the result via `apiResultBridge`).
