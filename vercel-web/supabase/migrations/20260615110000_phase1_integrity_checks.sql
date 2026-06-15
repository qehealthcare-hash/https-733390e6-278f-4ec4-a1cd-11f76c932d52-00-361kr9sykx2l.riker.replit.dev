-- Phase 1 SSOT: non-negative financial guards + audit log updated_at.

begin;

alter table if exists public.hh_audit_logs
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.hh_billings
  add constraint hh_billings_sec_dep_nonneg check (sec_dep >= 0) not valid;

alter table if exists public.hh_svc_entries
  add constraint hh_svc_entries_amt_nonneg check (amt >= 0) not valid;

alter table if exists public.hh_svc_entries
  add constraint hh_svc_entries_count_nonneg check (count >= 0) not valid;

alter table if exists public.hh_svc_entries
  add constraint hh_svc_entries_total_nonneg check (total >= 0) not valid;

alter table if exists public.hh_paid_transactions
  add constraint hh_paid_transactions_amount_nonneg check (amount >= 0) not valid;

alter table if exists public.hh_payouts
  add constraint hh_payouts_gross_nonneg check (gross_amount >= 0) not valid;

alter table if exists public.hh_payouts
  add constraint hh_payouts_net_nonneg check (net_amount >= 0) not valid;

alter table if exists public.hh_duties
  add constraint hh_duties_charge_per_day_nonneg check (charge_per_day >= 0) not valid;

alter table if exists public.hh_duties
  add constraint hh_duties_payout_per_day_nonneg check (payout_per_day >= 0) not valid;

commit;
