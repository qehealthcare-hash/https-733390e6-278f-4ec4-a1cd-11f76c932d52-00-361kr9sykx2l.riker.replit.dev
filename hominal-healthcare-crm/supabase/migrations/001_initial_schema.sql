create extension if not exists "pgcrypto";

create type public.crm_role as enum ('ADMIN', 'STAFF', 'ACCOUNTANT', 'NURSE', 'ATTENDANT');
create type public.shift_type as enum ('DAY', 'NIGHT', '24H');
create type public.patient_status as enum ('ACTIVE', 'CLOSED');
create type public.inquiry_potential as enum ('HOT', 'WARM', 'COLD');
create type public.invoice_status as enum ('OPEN', 'PAUSED', 'CLOSED');
create type public.invoice_type as enum ('PROVISIONAL', 'FINAL');
create type public.payment_mode as enum ('CASH', 'UPI', 'BANK');

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.crm_role not null,
  mobile text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text not null,
  address text not null,
  role public.crm_role not null,
  education text not null,
  shift_type public.shift_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  bucket text not null,
  path text not null,
  file_name text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  age integer not null check (age >= 0),
  gender text not null,
  address text not null,
  area text not null,
  city text not null,
  pincode text not null,
  mobile text not null,
  disease_condition text not null,
  assigned_staff_id uuid references public.employees(id),
  shift_type public.shift_type not null,
  start_date date not null,
  status public.patient_status not null default 'ACTIVE',
  close_reason text,
  relative_contacts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  bucket text not null,
  path text not null,
  file_name text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  patient_name text not null,
  mobile text not null,
  area text not null,
  city text not null,
  service_required text not null,
  source text not null,
  potential public.inquiry_potential not null default 'WARM',
  emergency_level integer not null check (emergency_level between 1 and 10),
  flexibility_score integer not null check (flexibility_score between 1 and 10),
  priority_score integer not null check (priority_score between 1 and 10),
  notes text not null default '',
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_month date not null,
  invoice_type public.invoice_type not null default 'PROVISIONAL',
  security_deposit numeric(12,2) not null default 0,
  subtotal_amount numeric(12,2) not null default 0,
  outstanding_amount numeric(12,2) not null default 0,
  status public.invoice_status not null default 'OPEN',
  close_reason text,
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  assigned_staff_id uuid references public.employees(id),
  service_name text not null,
  duration_label text not null,
  total_days integer not null default 0,
  total_people integer not null default 1,
  rate_per_day numeric(12,2) not null default 0,
  absent_days integer not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_mode public.payment_mode not null,
  received_on date not null,
  note text not null default '',
  received_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

create table public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  payout_month date not null,
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  pending_amount numeric(12,2) not null default 0,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payout_entries (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payout_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  invoice_item_id uuid references public.invoice_items(id) on delete set null,
  service_name text not null,
  total_days integer not null default 0,
  rate_per_day numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.payout_payments (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payout_runs(id) on delete cascade,
  amount_paid numeric(12,2) not null,
  payment_mode public.payment_mode not null,
  payment_date date not null,
  proof_file_path text,
  processed_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  module_name text not null,
  action_name text not null,
  record_id uuid,
  actor_user_id uuid references public.app_users(id),
  actor_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();
create trigger trg_employees_updated_at before update on public.employees for each row execute function public.set_updated_at();
create trigger trg_patients_updated_at before update on public.patients for each row execute function public.set_updated_at();
create trigger trg_inquiries_updated_at before update on public.inquiries for each row execute function public.set_updated_at();
create trigger trg_invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger trg_payout_runs_updated_at before update on public.payout_runs for each row execute function public.set_updated_at();

create or replace view public.vw_patient_billing_report as
select
  p.id as patient_id,
  p.full_name as patient_name,
  coalesce(inv.total_billed, 0) as total_billed,
  coalesce(rc.total_collected, 0) as total_collected,
  coalesce(inv.outstanding_amount, 0) as outstanding_amount,
  coalesce(inv.security_deposit, 0) as security_deposit
from public.patients p
left join (
  select
    patient_id,
    sum(subtotal_amount) as total_billed,
    sum(outstanding_amount) as outstanding_amount,
    sum(security_deposit) as security_deposit
  from public.invoices
  group by patient_id
) inv on inv.patient_id = p.id
left join (
  select
    i.patient_id,
    sum(r.amount) as total_collected
  from public.receipts r
  join public.invoices i on i.id = r.invoice_id
  group by i.patient_id
) rc on rc.patient_id = p.id;

create or replace view public.vw_employee_payout_report as
select
  e.id as employee_id,
  e.full_name as employee_name,
  coalesce(sum(pr.paid_amount), 0) as total_paid,
  coalesce(sum(pr.pending_amount), 0) as total_pending
from public.employees e
left join public.payout_runs pr on pr.employee_id = e.id
group by e.id, e.full_name;

create or replace view public.vw_profit_loss_report as
select
  to_char(months.month_key, 'YYYY-MM') as month_key,
  coalesce(revenue.total_revenue, 0) as total_revenue,
  coalesce(expense.total_expense, 0) as total_expense,
  coalesce(revenue.total_revenue, 0) - coalesce(expense.total_expense, 0) as net_profit
from (
  select date_trunc('month', service_month)::date as month_key from public.invoices
  union
  select date_trunc('month', payout_month)::date as month_key from public.payout_runs
) months
left join (
  select
    date_trunc('month', service_month)::date as month_key,
    sum(subtotal_amount) as total_revenue
  from public.invoices
  group by 1
) revenue on revenue.month_key = months.month_key
left join (
  select
    date_trunc('month', payout_month)::date as month_key,
    sum(total_amount) as total_expense
  from public.payout_runs
  group by 1
) expense on expense.month_key = months.month_key;

create or replace view public.vw_inquiry_conversion_report as
select
  source,
  count(*) as total_inquiries,
  count(*) filter (where exists (
    select 1 from public.patients p
    where lower(p.full_name) = lower(i.patient_name)
  )) as converted_to_patients,
  round(
    100 * count(*) filter (where exists (
      select 1 from public.patients p
      where lower(p.full_name) = lower(i.patient_name)
    ))::numeric / nullif(count(*), 0),
    2
  ) as conversion_rate,
  count(*) filter (where potential = 'HOT') as hot_count,
  count(*) filter (where potential = 'WARM') as warm_count,
  count(*) filter (where potential = 'COLD') as cold_count
from public.inquiries i
group by source;

create or replace view public.vw_attendance_service_report as
select
  e.id as employee_id,
  e.full_name as employee_name,
  count(distinct ii.patient_id) as patients_served,
  coalesce(sum(ii.total_days - ii.absent_days), 0) as worked_days,
  coalesce(sum(ii.absent_days), 0) as absent_days
from public.employees e
left join public.invoice_items ii on ii.assigned_staff_id = e.id
group by e.id, e.full_name;

alter table public.app_users enable row level security;
alter table public.employees enable row level security;
alter table public.employee_documents enable row level security;
alter table public.patients enable row level security;
alter table public.patient_documents enable row level security;
alter table public.inquiries enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.receipts enable row level security;
alter table public.payout_runs enable row level security;
alter table public.payout_entries enable row level security;
alter table public.payout_payments enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select role::text from public.app_users where auth_user_id = auth.uid() limit 1;
$$;

create policy "authenticated users can read app data" on public.app_users
for select using (auth.role() = 'authenticated');

create policy "admin manages app users" on public.app_users
for all using (public.current_user_role() = 'ADMIN')
with check (public.current_user_role() = 'ADMIN');

create policy "authenticated can read employees" on public.employees
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage employees" on public.employees
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read employee documents" on public.employee_documents
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage employee documents" on public.employee_documents
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read patients" on public.patients
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage patients" on public.patients
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read patient documents" on public.patient_documents
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage patient documents" on public.patient_documents
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read inquiries" on public.inquiries
for select using (auth.role() = 'authenticated');

create policy "admin and staff manage inquiries" on public.inquiries
for all using (public.current_user_role() in ('ADMIN', 'STAFF'))
with check (public.current_user_role() in ('ADMIN', 'STAFF'));

create policy "authenticated can read invoices" on public.invoices
for select using (auth.role() = 'authenticated');

create policy "admin staff accountant manage invoices" on public.invoices
for all using (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

create policy "authenticated can read invoice items" on public.invoice_items
for select using (auth.role() = 'authenticated');

create policy "admin staff accountant manage invoice items" on public.invoice_items
for all using (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

create policy "authenticated can read receipts" on public.receipts
for select using (auth.role() = 'authenticated');

create policy "admin staff accountant manage receipts" on public.receipts
for all using (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

create policy "authenticated can read payouts" on public.payout_runs
for select using (auth.role() = 'authenticated');

create policy "admin accountant manage payouts" on public.payout_runs
for all using (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'));

create policy "authenticated can read payout entries" on public.payout_entries
for select using (auth.role() = 'authenticated');

create policy "admin accountant manage payout entries" on public.payout_entries
for all using (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'));

create policy "authenticated can read payout payments" on public.payout_payments
for select using (auth.role() = 'authenticated');

create policy "admin accountant manage payout payments" on public.payout_payments
for all using (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'))
with check (public.current_user_role() in ('ADMIN', 'ACCOUNTANT'));

create policy "admin can read audit logs" on public.audit_logs
for select using (public.current_user_role() = 'ADMIN');

create policy "api writes audit logs" on public.audit_logs
for insert with check (public.current_user_role() in ('ADMIN', 'STAFF', 'ACCOUNTANT'));

insert into storage.buckets (id, name, public)
values
  ('employee-documents', 'employee-documents', false),
  ('patient-documents', 'patient-documents', false),
  ('payout-proofs', 'payout-proofs', false)
on conflict (id) do nothing;

create policy "employee documents authenticated object access"
on storage.objects
for select
using (bucket_id = 'employee-documents' and auth.role() = 'authenticated');

create policy "patient documents authenticated object access"
on storage.objects
for select
using (bucket_id = 'patient-documents' and auth.role() = 'authenticated');

create policy "payout proofs authenticated object access"
on storage.objects
for select
using (bucket_id = 'payout-proofs' and auth.role() = 'authenticated');
