-- Corporate reference data, settings, formal receipt→service allocations, PDF storage.
-- Safe to apply after 001–005. Idempotent where possible.

-- ---------------------------------------------------------------------------
-- Reference: doctors (referrers / visiting physicians — not the same as employees)
-- ---------------------------------------------------------------------------
create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  specialization text not null default '',
  mobile text not null default '',
  email text not null default '',
  address text not null default '',
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_doctors_active_name on public.doctors (active, lower(full_name));

-- ---------------------------------------------------------------------------
-- Reference: vendors
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null default '',
  mobile text not null default '',
  email text not null default '',
  gst text not null default '',
  pan text not null default '',
  address text not null default '',
  city text not null default '',
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vendors_active_name on public.vendors (active, lower(name));

-- ---------------------------------------------------------------------------
-- Service catalog (normalized names; billing still stores text on patient_services)
-- ---------------------------------------------------------------------------
create table if not exists public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null unique,
  description text not null default '',
  default_daily_rate numeric(12,2) not null default 0 check (default_daily_rate >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_catalog_active on public.service_catalog (active, sort_order);

-- ---------------------------------------------------------------------------
-- App settings (company logo path, signatory, seal, feature flags)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Formal allocation: which patient_service rows a billing_receipt paid
-- (audit + supports partial splits; triggers can populate from create_billing_receipt later)
-- ---------------------------------------------------------------------------
create table if not exists public.receipt_service_allocations (
  id uuid primary key default gen_random_uuid(),
  billing_receipt_id uuid not null references public.billing_receipts(id) on delete cascade,
  patient_service_id uuid not null references public.patient_services(id) on delete restrict,
  allocated_amount numeric(12,2) not null default 0 check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  unique (billing_receipt_id, patient_service_id)
);

create index if not exists idx_receipt_alloc_receipt on public.receipt_service_allocations (billing_receipt_id);
create index if not exists idx_receipt_alloc_service on public.receipt_service_allocations (patient_service_id);

-- ---------------------------------------------------------------------------
-- Optional link: patient → doctor referrer (non-breaking)
-- ---------------------------------------------------------------------------
alter table public.patients
  add column if not exists referrer_doctor_id uuid references public.doctors(id) on delete set null;

create index if not exists idx_patients_referrer_doctor on public.patients (referrer_doctor_id);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_doctors_updated_at') then
    create trigger trg_doctors_updated_at before update on public.doctors for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_vendors_updated_at') then
    create trigger trg_vendors_updated_at before update on public.vendors for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_service_catalog_updated_at') then
    create trigger trg_service_catalog_updated_at before update on public.service_catalog for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.doctors enable row level security;
alter table public.vendors enable row level security;
alter table public.service_catalog enable row level security;
alter table public.app_settings enable row level security;
alter table public.receipt_service_allocations enable row level security;

create policy "authenticated can read doctors" on public.doctors
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage doctors" on public.doctors
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read vendors" on public.vendors
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage vendors" on public.vendors
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read service catalog" on public.service_catalog
for select using (auth.role() = 'authenticated');

create policy "admin staff accountant manage service catalog" on public.service_catalog
for all using (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

create policy "authenticated can read app settings" on public.app_settings
for select using (auth.role() = 'authenticated');

create policy "admin manages app settings" on public.app_settings
for all using (public.current_user_role() = 'ADMIN')
with check (public.current_user_role() = 'ADMIN');

create policy "authenticated can read receipt allocations" on public.receipt_service_allocations
for select using (auth.role() = 'authenticated');

create policy "admin staff accountant manage receipt allocations" on public.receipt_service_allocations
for all using (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

-- ---------------------------------------------------------------------------
-- Storage: generated PDFs (server uploads via service role; users read via JWT)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('invoice-pdfs', 'invoice-pdfs', false),
  ('receipt-pdfs', 'receipt-pdfs', false),
  ('payout-pdfs', 'payout-pdfs', false),
  ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

create policy "invoice pdfs authenticated read"
on storage.objects
for select
using (bucket_id = 'invoice-pdfs' and auth.role() = 'authenticated');

create policy "receipt pdfs authenticated read"
on storage.objects
for select
using (bucket_id = 'receipt-pdfs' and auth.role() = 'authenticated');

create policy "payout pdfs authenticated read"
on storage.objects
for select
using (bucket_id = 'payout-pdfs' and auth.role() = 'authenticated');

create policy "company assets authenticated read"
on storage.objects
for select
using (bucket_id = 'company-assets' and auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Seed default services (idempotent)
-- ---------------------------------------------------------------------------
insert into public.service_catalog (code, name, description, default_daily_rate, sort_order)
values
  ('CT', 'Care Taker Services', 'Home care attendant / caretaker', 0, 10),
  ('NS', 'Nursing Services', 'Skilled nursing visits', 0, 20),
  ('DV', 'Doctor Visits', 'Visiting physician', 0, 30)
on conflict (name) do nothing;
