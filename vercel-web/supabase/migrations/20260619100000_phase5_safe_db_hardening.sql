-- Phase 5 — safe database hardening (audit follow-up)
--
-- Non-breaking remediation of advisor findings. No table data is modified and
-- no application code depends on these changes, so this can be applied ahead of
-- or independently from an app deploy.
--
--   1. Drop leftover SECURITY DEFINER test-probe functions (dead scaffolding
--      that signed-in users could call via the REST API).
--   2. Pin a non-mutable search_path on duty/billing/payout helper functions
--      flagged by lint 0011. These are pure public-schema functions; the
--      auth/RBAC functions already carry `search_path = public, auth` and are
--      intentionally left untouched.
--   3. Satisfy the "every table has created_at/updated_at" convention for the
--      two tables that were missing them.
--
-- NOTE: "Leaked password protection" (auth advisor) is a GoTrue setting and
-- must be toggled in the Supabase dashboard (Auth → Providers → Password) — it
-- cannot be set from SQL.

begin;

-- 1. Remove dead test-probe functions -------------------------------------------------
drop function if exists public.audit_probe_p1_4_ok();
drop function if exists public.audit_probe_p1_11_ok();
drop function if exists public.audit_probe_p1_12_ok();
drop function if exists public.audit_probe_p1_13_ok();
drop function if exists public.audit_probe_p1_14_ok();

-- 2. Pin search_path on public-schema helper functions --------------------------------
-- Safe: these have no current `proconfig`, and the default search_path does not
-- include `auth`, so they provably do not rely on unqualified auth-schema refs.
alter function public.hh_payout_hours_for_term(p_term text) set search_path = public;
alter function public.hh_reconciliation_hours_for_term(p_term text) set search_path = public;
alter function public.hh_sync_ledger_duty_id_from_remarks() set search_path = public;
alter function public.hominal_attendance_hours_for_shift(p_shift text) set search_path = public;
alter function public.hominal_duty_day_excluded(p_excluded jsonb, p_day text, p_employee_id text) set search_path = public;
alter function public.hominal_duty_reconciliation_report(p_from date, p_to date, p_actor text) set search_path = public;
alter function public.hominal_materialize_due_duty_days(p_from date, p_to date, p_limit integer, p_actor text) set search_path = public;
alter function public.hominal_recompute_payouts_from_charge_attendance(p_from date, p_to date, p_actor text) set search_path = public;
alter function public.hominal_repair_duty_ledger_window(p_from date, p_to date, p_actor text) set search_path = public;
alter function public.hominal_replace_payout_charges(p_svc_key text, p_rows jsonb) set search_path = public;
alter function public.hominal_replace_service_entries(p_svc_key text, p_rows jsonb) set search_path = public;
alter function public.hominal_set_duty_ledger_write(p_on boolean) set search_path = public;
alter function public.hominal_sync_attendance_from_payout_charges(p_from date, p_to date, p_actor text) set search_path = public;
alter function public.hominal_sync_duty_attendance_payout(p_from date, p_to date, p_actor text) set search_path = public;

-- 3. created_at / updated_at on the two tables missing them ---------------------------
alter table public.hh_invoice_lines
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.hh_ledger_duplicate_repairs
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Reuse the existing shared touch trigger so updated_at stays accurate.
drop trigger if exists hh_invoice_lines_updated_at on public.hh_invoice_lines;
create trigger hh_invoice_lines_updated_at
  before update on public.hh_invoice_lines
  for each row execute function public.hh_set_updated_at();

drop trigger if exists hh_ledger_duplicate_repairs_updated_at on public.hh_ledger_duplicate_repairs;
create trigger hh_ledger_duplicate_repairs_updated_at
  before update on public.hh_ledger_duplicate_repairs
  for each row execute function public.hh_set_updated_at();

commit;
