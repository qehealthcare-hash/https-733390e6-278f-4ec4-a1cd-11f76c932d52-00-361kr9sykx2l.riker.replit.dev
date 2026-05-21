begin;

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

alter table public.hh_paid_transactions add column if not exists employee_id text;
alter table public.hh_paid_transactions add column if not exists patient_id text;
alter table public.hh_paid_transactions add column if not exists patient_name text;
alter table public.hh_paid_transactions add column if not exists service_type text;
alter table public.hh_paid_transactions add column if not exists svc_key text;
alter table public.hh_paid_transactions add column if not exists payout_mode text;
alter table public.hh_paid_transactions add column if not exists from_date date;
alter table public.hh_paid_transactions add column if not exists to_date date;
alter table public.hh_paid_transactions add column if not exists paid_days integer not null default 0;
alter table public.hh_paid_transactions add column if not exists paid_dates date[] not null default '{}'::date[];
alter table public.hh_paid_transactions add column if not exists remarks text default '';

create index if not exists hh_receipts_billing_active_idx
  on public.hh_receipts (billing_id, deleted_at, created_at desc);

create index if not exists hh_receipts_patient_service_dates_idx
  on public.hh_receipts (patient_id, service_type, from_date, to_date)
  where deleted_at is null;

create index if not exists hh_svc_entries_billing_service_date_idx
  on public.hh_svc_entries (billing_id, service_name, date);

create index if not exists hh_paid_transactions_partner_date_idx
  on public.hh_paid_transactions (partner, paid_on);

create index if not exists hh_paid_transactions_employee_dates_idx
  on public.hh_paid_transactions (employee_id, from_date, to_date);

commit;
