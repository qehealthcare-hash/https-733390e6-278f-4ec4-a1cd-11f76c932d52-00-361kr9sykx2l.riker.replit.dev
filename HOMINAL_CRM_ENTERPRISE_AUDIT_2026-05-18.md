# Hominal Healthcare CRM Enterprise Audit

Audit date: 2026-05-18  
Auditor role: CTO / full-stack architecture / Supabase backend / database / QA / security / DevOps

## Executive Summary

The CRM is not yet enterprise-ready. The main risk is not one broken button; it is architectural drift between three different systems:

1. The live browser CRM is a large legacy single-file app served inside a Next.js iframe from `legacy-crm.html`.
2. The Node/Express API expects modern tables such as `invoices`, `patient_services`, and `billing_receipts`.
3. The live Supabase production database is using legacy `hh_*` tables such as `hh_billings`, `hh_receipts`, and `hh_svc_entries`.

This mismatch is the root cause of repeated receipt failures, deleted rows returning after refresh, service selection mismatches, and billing/payout inconsistencies.

Enterprise readiness score: 3.2 / 10

## A. Complete CRM Audit Report

### Project Structure Findings

Production web entry:
- `vercel-web/app/page.js` renders `components/legacy-crm-frame.js`.
- `vercel-web/components/legacy-crm-frame.js` loads `/legacy-crm.html` in an iframe.
- Live `https://crm.hominalhealthcare.com/` confirms the production app is an iframe wrapper, not the newer React module pages.

Parallel code paths found:
- Legacy production CRM: `index.html`, `vercel-web/public/legacy-crm.html`, `hominal-healthcare-crm/apps/web/public/legacy-crm.html`
- Standalone web app: `vercel-web/app/*`
- Monorepo web app: `hominal-healthcare-crm/apps/web/*`
- Standalone API: `vercel-api/*`
- Monorepo API: `hominal-healthcare-crm/apps/api/*`
- Multiple Supabase schema files: `hominal_crm_supabase.sql`, hardening SQL, monorepo migrations, enterprise SQL

Critical issue:
- The three local legacy CRM copies are not identical:
  - `index.html`: `e3a12fd7...`
  - `vercel-web/public/legacy-crm.html`: `8fd937f2...`
  - `hominal-healthcare-crm/apps/web/public/legacy-crm.html`: `37bc3537...`
- This makes deployments unsafe because fixes can be applied to one file while Vercel serves another.

Dead/overlapping modules:
- New React pages exist for patients, billing, payout, reports, etc., but production root loads the legacy iframe.
- Backend API billing logic expects modern ledger tables that are missing in production.
- Legacy CRM directly calls Supabase REST and bypasses the Node API for many workflows.

## B. Supabase Backend Audit Report

### Live Production Tables

Production public tables confirmed in Supabase:
- `hh_billings`
- `hh_counters`
- `hh_doctors`
- `hh_employees`
- `hh_inquiries`
- `hh_paid_transactions`
- `hh_patients`
- `hh_payout_charges`
- `hh_receipts`
- `hh_roles`
- `hh_svc_entries`
- `hh_users`
- `hh_vendors`

Modern tables expected by API but not confirmed in live production:
- `invoices`
- `invoice_items`
- `receipts`
- `patient_services`
- `billing_receipts`
- `staff_payouts`
- `payout_runs`
- `payout_entries`

### Live Production Row Counts

Read-only integrity query results:

| Metric | Value |
|---|---:|
| Patients | 64 |
| Employees | 65 |
| Billings | 62 |
| Receipts | 46 |
| Service entries | 1,663 |
| Payout charges | 251 |
| Orphan billings | 0 |
| Orphan receipts | 0 |
| Orphan service entries | 20 |
| Duplicate patient phone groups | 4 |
| Duplicate receipt IDs | 0 |
| Duplicate same-day service groups | 51 |

### Live Schema Gaps

`hh_receipts` columns:
- `id`, `billing_id`, `date`, `type`, `amount`, `method`, `ref`, `remarks`, `created_at`, `updated_at`

Missing columns required for stable billing:
- `patient_id`
- `service_type`
- `bill_mode`
- `from_date`
- `to_date`
- `paid_days`
- `paid_dates`
- `deleted_at`
- `created_by`
- `updated_by`
- `deleted_by`

`hh_svc_entries` columns:
- `id`, `svc_key`, `billing_id`, `service_name`, `partner`, `partner_id`, `date`, `freq`, `amt`, `count`, `disc`, `total`, `remarks`, `created_at`, `updated_at`

Missing columns required for ERP-grade duty ledger:
- `service_date` as real `date`
- `patient_id`
- `employee_id`
- `shift_type`
- `billing_status`
- `payout_status`
- `receipt_id`
- `payout_id`
- `deleted_at`
- audit columns

### Functions / RPCs

Live functions found:
- `hh_auth_email`
- `hh_current_app_user`
- `hh_is_active_app_user`
- `hh_lookup_login`
- `hh_set_updated_at`

Missing modern ledger RPCs:
- `create_billing_receipt`
- `soft_delete_billing_receipt`
- `restore_billing_receipt`
- `recalculate_invoice_outstanding`
- `create_staff_payout`
- `soft_delete_staff_payout`

### Realtime

Realtime publication query returned zero `hh_*` tables.  
The legacy CRM uses polling (`runOfficeLiveSyncCheck`) rather than true Supabase Realtime.

Result:
- Multi-device sync is not true realtime.
- Save/delete conflicts are expected under concurrent office use.

### Storage

`storage.buckets` returned zero rows.  
This means production Supabase storage is not configured for:
- patient documents
- employee documents
- payout proofs
- invoice PDFs
- receipt PDFs
- company assets

## C. Data Integrity Failure Report

Confirmed failures:
- 20 service entries reference missing or empty billing relationships.
- 51 duplicate same-day service groups exist.
- 4 patient phone duplicate groups exist.
- Receipts do not have date-range fields, so paid days cannot be reliably reconstructed from database columns.
- Service entries store dates as text, not `date`, creating sorting and timezone risks.

Primary source-of-truth problem:
- Billing, payout, and reports are not driven by a normalized duty calendar.
- `hh_svc_entries` is being used as both service ledger and billing line storage.
- Payout charges are separate from staff duty source and can drift.

## D. Duplicate / Overlap Issue Report

Duplicate service samples from live data:

| Billing | Service | Partner | Date | Count |
|---|---|---|---|---:|
| `INVE00142` | Care Taker Services | Dhani ben Narotam bhai Makvana | 7 Apr 2026 | 2 |
| `INVE00168` | Care Taker Services | blank | 1 May 2026 | 2 |
| `INVE00137` | Care Taker Services | blank | 9 Apr 2026 | 2 |
| `INVE00142` | Care Taker Services | Dhani ben Narotam bhai Makvana | 12 Apr 2026 | 2 |
| `INVE00137` | Care Taker Services | blank | 17 Apr 2026 | 2 |

Root causes:
- No unique constraint for `billing_id + service_name + partner/employee + date + shift`.
- Legacy sync deletes and reinserts all service rows for a `svc_key`, which is unsafe across multiple devices.
- Conflict detection is frontend-only and can block users without resolving the actual database state.

## E. Billing and Payout Risk Report

Critical billing risks:
- The live receipt table lacks `deleted_at`; soft delete cannot be reliable without adding the column.
- The live receipt table lacks `from_date`, `to_date`, and `paid_days`; monthly billing cannot reliably subtract paid days from future billing.
- The modern API ledger migration cannot apply to production because production lacks `public.invoices`.
- The legacy frontend stores receipt metadata inside `remarks` as a compatibility workaround, which is fragile for financial accounting.
- Security deposit and service receipt logic are mixed in one receipt table without enforced transaction type constraints.

Critical payout risks:
- `hh_paid_transactions` has no `employee_id`, `patient_id`, `service_type`, `from_date`, `to_date`, `paid_days`, or `paid_dates` in live schema.
- `hh_payout_charges` is not linked by foreign key to employees, patients, service entries, or billings.
- Same staff can be paid twice for the same patient/date because no unique duty or payout allocation constraint exists.

Required financial source of truth:
- A normalized `duty_calendar` or `patient_service_days` table must become the source for both patient billing and staff payout.

## F. Security / RLS Report

RLS status:
- RLS is enabled on all 13 live `hh_*` tables.

Policy risk:
- Live policies include `public_access` with `true` / `true` on multiple `hh_*` tables.
- Current grants show only `authenticated` has table privileges, but the `public_access` policies are dangerous because future grants or function access can expose data instantly.

Permission risk:
- All authenticated users have `SELECT, INSERT, UPDATE, DELETE` on all `hh_*` tables.
- This is not role-based at the database layer.
- Application roles exist in `hh_roles`, but the DB does not enforce module-level write restrictions.

Authentication risk:
- Legacy CRM embeds the Supabase anon key in the browser, which is expected for Supabase browser apps.
- Because the browser writes directly to tables, RLS must be strong. It is currently too broad.
- `hh_users.password` exists as a nullable column. Even if currently null, password storage in app tables is a security smell and should be removed or locked.

Storage risk:
- No buckets exist, so document upload cannot be enterprise-grade or auditable.
- If documents are stored as base64/json in tables, database bloat and privacy risk will grow quickly.

## G. Performance Report

Performance risks:
- Legacy app loads entire tables into browser memory.
- `hh_svc_entries` already has 1,663 rows; this will become slow as data grows.
- Reports are calculated in frontend by scanning local arrays.
- Service sync deletes and reinserts full buckets.
- No pagination is enforced for patients, employees, receipts, or service entries.
- Text dates prevent efficient date-range indexing.

Indexes present:
- Basic primary keys
- `hh_billings(patient_id)`
- `hh_receipts(billing_id)`
- `hh_svc_entries(svc_key)`
- `hh_svc_entries(billing_id)`
- `hh_payout_charges(svc_key)`
- `hh_payout_charges(partner)`

Missing indexes:
- `hh_patients(created_at / registered_at)`
- `hh_patients(phone)`
- `hh_svc_entries(billing_id, service_name, date)`
- `hh_receipts(billing_id, deleted_at)`
- future `duty_calendar(patient_id, service_date, shift_type)`
- future `duty_calendar(employee_id, service_date, shift_type)`

## H. Missing Workflow Report

Missing or incomplete enterprise workflows:
- No true duty calendar table.
- No enforced staff assignment history.
- No replacement-staff ledger.
- No leave ledger.
- No formal invoice table in live legacy schema.
- No receipt allocation table.
- No staff payout allocation table.
- No document storage buckets.
- No database audit log for every legacy write.
- No role-enforced table writes.
- No backup/restore plan in repo.
- No rollback plan for schema migrations.
- No automated test suite for billing/payout.
- No production monitoring/error tracking.

## I. Exact Fix Roadmap

### Phase 1: Critical Data Integrity Fixes

1. Freeze schema direction: production must either stay legacy `hh_*` or migrate to modern tables. Do not operate both for finance.
2. Add safe columns to live legacy tables:
   - `hh_receipts.deleted_at timestamptz`
   - `hh_receipts.patient_id text`
   - `hh_receipts.service_type text`
   - `hh_receipts.bill_mode text`
   - `hh_receipts.from_date date`
   - `hh_receipts.to_date date`
   - `hh_receipts.paid_days integer`
   - `hh_receipts.paid_dates date[]`
   - `hh_receipts.created_by text`
   - `hh_receipts.deleted_by text`
3. Add soft-delete filtering everywhere.
4. Deduplicate live `hh_svc_entries` after manual review, not by blind deletion.
5. Add uniqueness protection for future service-day duplicates.

### Phase 2: Supabase Backend and RLS Hardening

1. Drop `public_access` policies from all `hh_*` tables.
2. Replace broad authenticated write policies with role-aware policies.
3. Remove direct delete grants for non-admin roles.
4. Lock `hh_users` so only admins can read/write user records.
5. Disable or restrict `hh_lookup_login` from anon access.
6. Create storage buckets with strict authenticated policies.

### Phase 3: Billing / Payout Synchronization Fixes

1. Create `hh_duty_days` as the single source of truth:
   - `id uuid`
   - `patient_id text`
   - `billing_id text`
   - `employee_id text`
   - `service_type text`
   - `service_date date`
   - `shift_type text`
   - `patient_rate numeric`
   - `staff_rate numeric`
   - `billing_receipt_id text`
   - `payout_transaction_id text`
   - statuses and audit fields
2. Backfill `hh_duty_days` from `hh_svc_entries`.
3. Receipt creation must mark selected `hh_duty_days` as paid inside an RPC transaction.
4. Receipt delete must soft delete receipt and release those duty days inside an RPC transaction.
5. Payout creation/deletion must mirror the same pattern.

### Phase 4: Frontend Workflow Fixes

1. Make one deploy source for `legacy-crm.html`.
2. Remove duplicate divergent legacy files or generate them from one file.
3. Replace delete-and-reinsert service sync with row-level upsert/update/delete.
4. Replace conflict banners that block every save with revision-based conflict detection.
5. Refactor receipt modal to use invoice/duty rows from Supabase, not computed local state.

### Phase 5: Reporting Accuracy Fixes

1. Move financial report calculations into SQL views/RPCs.
2. Reports must read active receipts and active duty rows only.
3. Dashboard totals must use the same views as reports.
4. Export CSV must export the same server-returned rows shown in UI.

### Phase 6: Performance Optimization

1. Add pagination to all large lists.
2. Add server-side filters for patients, employees, billing, payout, reports.
3. Add date indexes after converting text dates to `date`.
4. Replace full-table polling with realtime subscriptions or server refresh by module.

### Phase 7: Production Deployment Hardening

1. Pick one production deployment root.
2. Ensure Vercel builds from the same directory that contains the fixed `legacy-crm.html`.
3. Add build validation:
   - HTML JS extraction + `node --check`
   - API `node --check`
   - Next build after dependencies install
4. Add migration journal and rollback scripts.
5. Add daily Supabase backup/export.

### Phase 8: AI / Automation Readiness

1. Normalize patient, duty, invoice, receipt, payout, and report data.
2. Add audit logs for every workflow event.
3. Add business-event views for AI summaries.
4. Add a safe read-only reporting API for future AI assistant use.

## J. Files That Need Changes

High priority:
- `index.html`
- `vercel-web/public/legacy-crm.html`
- `hominal-healthcare-crm/apps/web/public/legacy-crm.html`
- `hominal_crm_supabase.sql`
- new live-compatible migration for `hh_*` ledger hardening

Backend if modern API remains part of production:
- `vercel-api/src/services/billing.service.js`
- `vercel-api/src/services/payout.service.js`
- `vercel-api/src/routes/billings.routes.js`
- `vercel-api/src/routes/payouts.routes.js`
- mirrored files under `hominal-healthcare-crm/apps/api/src/*`

Deployment:
- `vercel-web/vercel.json`
- `hominal-healthcare-crm/vercel.json`
- deployment scripts under `hominal-healthcare-crm/scripts`

## K. Database Migrations Required

Immediate legacy-safe migration:

```sql
alter table public.hh_receipts add column if not exists patient_id text;
alter table public.hh_receipts add column if not exists service_type text;
alter table public.hh_receipts add column if not exists bill_mode text;
alter table public.hh_receipts add column if not exists from_date date;
alter table public.hh_receipts add column if not exists to_date date;
alter table public.hh_receipts add column if not exists paid_days integer not null default 0;
alter table public.hh_receipts add column if not exists paid_dates date[] not null default '{}'::date[];
alter table public.hh_receipts add column if not exists deleted_at timestamptz;
alter table public.hh_receipts add column if not exists created_by text;
alter table public.hh_receipts add column if not exists deleted_by text;

create index if not exists hh_receipts_billing_active_idx
on public.hh_receipts (billing_id, deleted_at, created_at desc);

create index if not exists hh_svc_entries_billing_service_date_idx
on public.hh_svc_entries (billing_id, service_name, date);
```

Next migration:
- Create `hh_duty_days`.
- Backfill from `hh_svc_entries`.
- Create RPCs:
  - `hh_create_receipt`
  - `hh_soft_delete_receipt`
  - `hh_create_payout`
  - `hh_soft_delete_payout`
  - `hh_recalculate_billing_summary`

Security migration:
- Drop `public_access` policies.
- Add role-aware policies.
- Create storage buckets and policies.

## L. Test Cases Required

Each critical workflow must be tested three times: before fix, after fix, after refresh/re-login.

Required tests:
- Create patient persists after refresh.
- Edit patient updates table, dashboard, billing dropdown.
- Assign staff creates duty rows.
- Create service entry saves once, refreshes once, and does not duplicate.
- Edit service entry updates amount and staff.
- Delete service entry does not return after refresh.
- Create provisional bill for selected month.
- Add partial receipt against selected service/date range.
- Add second receipt excludes already paid days.
- Delete receipt releases paid days and does not return after refresh.
- Close bill requires reason and updates patient status.
- Create payout for staff with multiple patients.
- Partial payout updates balance.
- Delete payout releases unpaid work days.
- Dashboard totals equal report totals.
- Patient billing report equals SQL totals.
- Employee payout report equals SQL totals.
- Role login blocks unauthorized modules.
- Mobile patient and billing screens preserve buttons and tables.

## M. Final Enterprise Readiness Score

Score: 3.2 / 10

Breakdown:
- Architecture clarity: 3 / 10
- Supabase schema consistency: 3 / 10
- Billing accuracy: 2 / 10
- Payout accuracy: 2 / 10
- Security/RLS: 4 / 10
- Realtime sync: 2 / 10
- Frontend workflow stability: 4 / 10
- Deployment reliability: 3 / 10
- Reporting accuracy: 3 / 10
- Performance readiness: 4 / 10

The CRM can be stabilized without rewriting everything, but the immediate work must focus on production `hh_*` schema compatibility, a real duty ledger, and one deployment source. Random frontend-only fixes will continue to create the same refresh/sync problems.
