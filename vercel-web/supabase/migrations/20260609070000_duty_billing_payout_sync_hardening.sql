-- Hominal Healthcare CRM — duty/billing/payout sync hardening.
-- Idempotent migration: prevents exact duplicate materialized duty rows and
-- enables realtime for every table that changes billing/payout visibility.

begin;

alter table if exists public.hh_svc_entries replica identity full;
alter table if exists public.hh_payout_charges replica identity full;
alter table if exists public.hh_paid_transactions replica identity full;
alter table if exists public.hh_payouts replica identity full;
alter table if exists public.hh_duties replica identity full;
alter table if exists public.hh_attendance replica identity full;
alter table if exists public.hh_billings replica identity full;
alter table if exists public.hh_receipts replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array[
    'hh_svc_entries',
    'hh_payout_charges',
    'hh_paid_transactions',
    'hh_payouts',
    'hh_duties',
    'hh_attendance',
    'hh_billings',
    'hh_receipts'
  ]
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = t
    ) and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Clean only exact duplicate materialized service rows before creating the
-- prevention index. Keep the newest physical row.
delete from public.hh_svc_entries a
using public.hh_svc_entries b
where a.ctid < b.ctid
  and coalesce(a.svc_key, '') = coalesce(b.svc_key, '')
  and coalesce(a.billing_id, '') = coalesce(b.billing_id, '')
  and lower(coalesce(a.service_name, '')) = lower(coalesce(b.service_name, ''))
  and coalesce(a.date, '') = coalesce(b.date, '')
  and coalesce(a.partner_id, '') = coalesce(b.partner_id, '')
  and lower(coalesce(a.partner, '')) = lower(coalesce(b.partner, ''))
  and lower(coalesce(a.freq, '')) = lower(coalesce(b.freq, ''))
  and coalesce(a.remarks, '') = coalesce(b.remarks, '');

delete from public.hh_payout_charges a
using public.hh_payout_charges b
where a.ctid < b.ctid
  and coalesce(a.svc_key, '') = coalesce(b.svc_key, '')
  and lower(coalesce(a.service_name, '')) = lower(coalesce(b.service_name, ''))
  and coalesce(a.date, '') = coalesce(b.date, '')
  and coalesce(a.partner_id, '') = coalesce(b.partner_id, '')
  and lower(coalesce(a.partner, '')) = lower(coalesce(b.partner, ''))
  and lower(coalesce(a.term, '')) = lower(coalesce(b.term, ''))
  and coalesce(a.remarks, '') = coalesce(b.remarks, '');

create unique index if not exists uq_hh_svc_entries_duty_day_staff
  on public.hh_svc_entries (
    coalesce(svc_key, ''),
    coalesce(billing_id, ''),
    lower(coalesce(service_name, '')),
    coalesce(date, ''),
    coalesce(partner_id, ''),
    lower(coalesce(partner, '')),
    lower(coalesce(freq, '')),
    coalesce(remarks, '')
  )
  where coalesce(remarks, '') like 'duty:%';

create unique index if not exists uq_hh_payout_charges_duty_day_staff
  on public.hh_payout_charges (
    coalesce(svc_key, ''),
    lower(coalesce(service_name, '')),
    coalesce(date, ''),
    coalesce(partner_id, ''),
    lower(coalesce(partner, '')),
    lower(coalesce(term, '')),
    coalesce(remarks, '')
  )
  where coalesce(remarks, '') like 'duty:%';

create index if not exists idx_hh_duties_patient_status_window
  on public.hh_duties (patient_id, status, start_at, end_at);

create index if not exists idx_hh_duties_employee_status_window
  on public.hh_duties (employee_id, status, start_at, end_at);

create index if not exists idx_hh_payout_charges_partner_period
  on public.hh_payout_charges (partner_id, date);

create index if not exists idx_hh_svc_entries_billing_period
  on public.hh_svc_entries (billing_id, date);

commit;
