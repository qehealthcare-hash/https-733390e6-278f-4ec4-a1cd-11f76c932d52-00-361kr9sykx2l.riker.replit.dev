-- Phase 3 SSOT: enforce Phase 1 non-negative CHECK constraints on new writes.
-- Pre-check (2026-06-17): zero violating rows in production.

begin;

alter table public.hh_billings validate constraint hh_billings_sec_dep_nonneg;
alter table public.hh_svc_entries validate constraint hh_svc_entries_amt_nonneg;
alter table public.hh_svc_entries validate constraint hh_svc_entries_count_nonneg;
alter table public.hh_svc_entries validate constraint hh_svc_entries_total_nonneg;
alter table public.hh_paid_transactions validate constraint hh_paid_transactions_amount_nonneg;
alter table public.hh_payouts validate constraint hh_payouts_gross_nonneg;
alter table public.hh_payouts validate constraint hh_payouts_net_nonneg;
alter table public.hh_duties validate constraint hh_duties_charge_per_day_nonneg;
alter table public.hh_duties validate constraint hh_duties_payout_per_day_nonneg;

commit;
