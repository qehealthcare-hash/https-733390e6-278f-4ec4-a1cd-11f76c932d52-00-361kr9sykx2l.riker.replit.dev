-- Legacy CRM invoice ledger tables (hh_*) to support invoice cut logic and receipts
-- This is separate from the newer normalized billing tables (public.invoices, etc.)

create table if not exists public.hh_invoices (
  id text primary key,
  invoice_no text not null,
  billing_id text not null,
  patient_id text not null,
  invoice_type text not null check (invoice_type in ('PROVISIONAL','FINAL')),
  status text not null,
  billing_month text,
  from_date date,
  to_date date,
  subtotal_amount numeric(12,2) not null default 0,
  outstanding_amount numeric(12,2) not null default 0,
  snapshot_html text,
  deleted_at timestamptz,
  created timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_invoice_items (
  id text primary key,
  invoice_id text not null references public.hh_invoices(id) on delete cascade,
  billing_id text not null,
  patient_id text not null,
  svc_key text not null,
  service_name text not null,
  from_date date,
  to_date date,
  unpaid_days integer not null default 0,
  service_dates text[] not null default '{}'::text[],
  rate numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_billing_receipts (
  id text primary key,
  receipt_no text not null,
  invoice_id text not null references public.hh_invoices(id) on delete cascade,
  billing_id text not null,
  patient_id text not null,
  transaction_type text not null default 'PAYMENT',
  amount numeric(12,2) not null default 0,
  method text not null,
  received_on date not null,
  remarks text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.hh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_hh_invoices_updated_at') then
    create trigger trg_hh_invoices_updated_at before update on public.hh_invoices
    for each row execute function public.hh_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_hh_invoice_items_updated_at') then
    create trigger trg_hh_invoice_items_updated_at before update on public.hh_invoice_items
    for each row execute function public.hh_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_hh_billing_receipts_updated_at') then
    create trigger trg_hh_billing_receipts_updated_at before update on public.hh_billing_receipts
    for each row execute function public.hh_set_updated_at();
  end if;
end $$;

