-- Hominal Healthcare CRM - Supabase setup
-- This schema is designed for a static single-file CRM that uses Supabase Auth
-- for login and pure REST calls for data access.

begin;

create table if not exists public.hh_roles (
  id text primary key,
  name text not null unique,
  perms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_users (
  id text primary key,
  username text not null unique,
  email text default '',
  phone text default '',
  role text default '',
  password text,
  is_active boolean not null default true,
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_employees (
  id text primary key,
  fn text not null default '',
  mn text default '',
  ln text default '',
  email text default '',
  phone text default '',
  phone2 text default '',
  gender text default '',
  dob text default '',
  blood text default '',
  dept text default '',
  etype text default '',
  desig text default '',
  emp_type text default '',
  edu text default '',
  join_date text default '',
  leave_date text default '',
  exp text default '',
  shift text default '',
  salary text default '',
  aadhar text default '',
  pan text default '',
  permaddr text default '',
  presaddr text default '',
  pin text default '',
  district text default '',
  state text default '',
  ecname text default '',
  ecphone text default '',
  ecrel text default '',
  skills text default '',
  area text default '',
  photo jsonb,
  docs jsonb not null default '[]'::jsonb,
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_doctors (
  id text primary key,
  fn text not null default '',
  ln text default '',
  gender text default '',
  phone text default '',
  email text default '',
  city text default '',
  aadhar text default '',
  pan text default '',
  spec text default '',
  qual text default '',
  regno text default '',
  regcouncil text default '',
  regyear text default '',
  clinic text default '',
  clinicaddr text default '',
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_vendors (
  id text primary key,
  name text not null default '',
  contact text default '',
  phone text default '',
  email text default '',
  gst text default '',
  pan text default '',
  addr text default '',
  city text default '',
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_patients (
  id text primary key,
  name text not null default '',
  email text default '',
  phone text default '',
  dob text default '',
  gender text default '',
  blood text default '',
  addr text default '',
  area text default '',
  city text default '',
  pin text default '',
  relname text default '',
  relphone text default '',
  relname2 text default '',
  relphone2 text default '',
  relname3 text default '',
  relphone3 text default '',
  status text default '',
  photo jsonb,
  docs jsonb not null default '[]'::jsonb,
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hh_patients add column if not exists photo jsonb;
alter table public.hh_patients add column if not exists docs jsonb not null default '[]'::jsonb;

create table if not exists public.hh_inquiries (
  id text primary key,
  name text not null default '',
  phone text default '',
  wa text default '',
  age text default '',
  gender text default '',
  city text default '',
  area text default '',
  service text default '',
  source text default '',
  potential text default 'Warm',
  rating_emergency integer default 5,
  rating_flexibility integer default 5,
  rating_overall integer default 5,
  status text default 'New',
  assigned_to text default '',
  followup_date text default '',
  notes text default '',
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_billings (
  id text primary key,
  patient_id text not null,
  status text default 'Active',
  sec_dep numeric(12,2) not null default 0,
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hh_billings_patient_id_idx on public.hh_billings (patient_id);

create table if not exists public.hh_receipts (
  id text primary key,
  billing_id text not null,
  date text default '',
  type text default '',
  amount numeric(12,2) not null default 0,
  method text default '',
  ref text default '',
  remarks text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hh_receipts_billing_id_idx on public.hh_receipts (billing_id);

create table if not exists public.hh_svc_entries (
  id bigint generated by default as identity primary key,
  svc_key text not null,
  billing_id text default '',
  service_name text default '',
  partner text default '',
  date text default '',
  freq text default '',
  amt numeric(12,2) not null default 0,
  count numeric(12,2) not null default 1,
  disc numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  remarks text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hh_svc_entries_svc_key_idx on public.hh_svc_entries (svc_key);
create index if not exists hh_svc_entries_billing_id_idx on public.hh_svc_entries (billing_id);

create table if not exists public.hh_payout_charges (
  id bigint generated by default as identity primary key,
  svc_key text not null,
  date text default '',
  partner text default '',
  term text default '',
  amount numeric(12,2) not null default 0,
  remarks text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hh_payout_charges_svc_key_idx on public.hh_payout_charges (svc_key);
create index if not exists hh_payout_charges_partner_idx on public.hh_payout_charges (partner);

create table if not exists public.hh_paid_transactions (
  id text primary key,
  partner text default '',
  paid_on text default '',
  amount numeric(12,2) not null default 0,
  method text default '',
  photo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_counters (
  key text primary key,
  value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill columns for projects created from older CRM builds.
alter table public.hh_users add column if not exists email text default '';
alter table public.hh_users add column if not exists phone text default '';
alter table public.hh_users add column if not exists role text default '';
alter table public.hh_users add column if not exists password text;
alter table public.hh_users alter column password drop default;
update public.hh_users set email = lower(coalesce(email, ''));
update public.hh_users set password = null where password is not null;
alter table public.hh_users add column if not exists is_active boolean not null default true;
alter table public.hh_users add column if not exists created text default '';
alter table public.hh_users add column if not exists created_at timestamptz not null default now();
alter table public.hh_users add column if not exists updated_at timestamptz not null default now();

alter table public.hh_employees add column if not exists mn text default '';
alter table public.hh_employees add column if not exists ln text default '';
alter table public.hh_employees add column if not exists email text default '';
alter table public.hh_employees add column if not exists phone text default '';
alter table public.hh_employees add column if not exists phone2 text default '';
alter table public.hh_employees add column if not exists gender text default '';
alter table public.hh_employees add column if not exists dob text default '';
alter table public.hh_employees add column if not exists blood text default '';
alter table public.hh_employees add column if not exists dept text default '';
alter table public.hh_employees add column if not exists etype text default '';
alter table public.hh_employees add column if not exists desig text default '';
alter table public.hh_employees add column if not exists emp_type text default '';
alter table public.hh_employees add column if not exists edu text default '';
alter table public.hh_employees add column if not exists join_date text default '';
alter table public.hh_employees add column if not exists leave_date text default '';
alter table public.hh_employees add column if not exists exp text default '';
alter table public.hh_employees add column if not exists shift text default '';
alter table public.hh_employees add column if not exists salary text default '';
alter table public.hh_employees add column if not exists aadhar text default '';
alter table public.hh_employees add column if not exists pan text default '';
alter table public.hh_employees add column if not exists permaddr text default '';
alter table public.hh_employees add column if not exists presaddr text default '';
alter table public.hh_employees add column if not exists pin text default '';
alter table public.hh_employees add column if not exists district text default '';
alter table public.hh_employees add column if not exists state text default '';
alter table public.hh_employees add column if not exists ecname text default '';
alter table public.hh_employees add column if not exists ecphone text default '';
alter table public.hh_employees add column if not exists ecrel text default '';
alter table public.hh_employees add column if not exists skills text default '';
alter table public.hh_employees add column if not exists area text default '';
alter table public.hh_employees add column if not exists photo jsonb;
alter table public.hh_employees add column if not exists docs jsonb not null default '[]'::jsonb;
alter table public.hh_employees add column if not exists created text default '';
alter table public.hh_employees add column if not exists created_at timestamptz not null default now();
alter table public.hh_employees add column if not exists updated_at timestamptz not null default now();

alter table public.hh_doctors add column if not exists gender text default '';
alter table public.hh_doctors add column if not exists email text default '';
alter table public.hh_doctors add column if not exists city text default '';
alter table public.hh_doctors add column if not exists aadhar text default '';
alter table public.hh_doctors add column if not exists pan text default '';
alter table public.hh_doctors add column if not exists qual text default '';
alter table public.hh_doctors add column if not exists regno text default '';
alter table public.hh_doctors add column if not exists regcouncil text default '';
alter table public.hh_doctors add column if not exists regyear text default '';
alter table public.hh_doctors add column if not exists clinic text default '';
alter table public.hh_doctors add column if not exists clinicaddr text default '';
alter table public.hh_doctors add column if not exists created text default '';
alter table public.hh_doctors add column if not exists created_at timestamptz not null default now();
alter table public.hh_doctors add column if not exists updated_at timestamptz not null default now();

alter table public.hh_vendors add column if not exists contact text default '';
alter table public.hh_vendors add column if not exists phone text default '';
alter table public.hh_vendors add column if not exists email text default '';
alter table public.hh_vendors add column if not exists gst text default '';
alter table public.hh_vendors add column if not exists pan text default '';
alter table public.hh_vendors add column if not exists addr text default '';
alter table public.hh_vendors add column if not exists city text default '';
alter table public.hh_vendors add column if not exists created text default '';
alter table public.hh_vendors add column if not exists created_at timestamptz not null default now();
alter table public.hh_vendors add column if not exists updated_at timestamptz not null default now();

alter table public.hh_patients add column if not exists email text default '';
alter table public.hh_patients add column if not exists dob text default '';
alter table public.hh_patients add column if not exists gender text default '';
alter table public.hh_patients add column if not exists blood text default '';
alter table public.hh_patients add column if not exists addr text default '';
alter table public.hh_patients add column if not exists area text default '';
alter table public.hh_patients add column if not exists city text default '';
alter table public.hh_patients add column if not exists pin text default '';
alter table public.hh_patients add column if not exists relname text default '';
alter table public.hh_patients add column if not exists relphone text default '';
alter table public.hh_patients add column if not exists relname2 text default '';
alter table public.hh_patients add column if not exists relphone2 text default '';
alter table public.hh_patients add column if not exists relname3 text default '';
alter table public.hh_patients add column if not exists relphone3 text default '';
alter table public.hh_patients add column if not exists status text default '';
alter table public.hh_patients add column if not exists photo jsonb;
alter table public.hh_patients add column if not exists docs jsonb not null default '[]'::jsonb;
alter table public.hh_patients add column if not exists created text default '';
alter table public.hh_patients add column if not exists created_at timestamptz not null default now();
alter table public.hh_patients add column if not exists updated_at timestamptz not null default now();

alter table public.hh_inquiries add column if not exists wa text default '';
alter table public.hh_inquiries add column if not exists age text default '';
alter table public.hh_inquiries add column if not exists gender text default '';
alter table public.hh_inquiries add column if not exists city text default '';
alter table public.hh_inquiries add column if not exists area text default '';
alter table public.hh_inquiries add column if not exists service text default '';
alter table public.hh_inquiries add column if not exists source text default '';
alter table public.hh_inquiries add column if not exists potential text default 'Warm';
alter table public.hh_inquiries add column if not exists rating_emergency integer default 5;
alter table public.hh_inquiries add column if not exists rating_flexibility integer default 5;
alter table public.hh_inquiries add column if not exists rating_overall integer default 5;
alter table public.hh_inquiries add column if not exists status text default 'New';
alter table public.hh_inquiries add column if not exists assigned_to text default '';
alter table public.hh_inquiries add column if not exists followup_date text default '';
alter table public.hh_inquiries add column if not exists notes text default '';
alter table public.hh_inquiries add column if not exists created text default '';
alter table public.hh_inquiries add column if not exists created_at timestamptz not null default now();
alter table public.hh_inquiries add column if not exists updated_at timestamptz not null default now();

alter table public.hh_billings add column if not exists status text default 'Active';
alter table public.hh_billings add column if not exists sec_dep numeric(12,2) not null default 0;
alter table public.hh_billings add column if not exists created text default '';
alter table public.hh_billings add column if not exists created_at timestamptz not null default now();
alter table public.hh_billings add column if not exists updated_at timestamptz not null default now();

alter table public.hh_receipts add column if not exists date text default '';
alter table public.hh_receipts add column if not exists type text default '';
alter table public.hh_receipts add column if not exists patient_id text default '';
alter table public.hh_receipts add column if not exists service_type text default '';
alter table public.hh_receipts add column if not exists bill_mode text default '';
alter table public.hh_receipts add column if not exists from_date text default '';
alter table public.hh_receipts add column if not exists to_date text default '';
alter table public.hh_receipts add column if not exists paid_days numeric(12,2) not null default 0;
alter table public.hh_receipts add column if not exists paid_dates jsonb not null default '[]'::jsonb;
alter table public.hh_receipts add column if not exists amount numeric(12,2) not null default 0;
alter table public.hh_receipts add column if not exists method text default '';
alter table public.hh_receipts add column if not exists ref text default '';
alter table public.hh_receipts add column if not exists remarks text default '';
alter table public.hh_receipts add column if not exists created_at timestamptz not null default now();
alter table public.hh_receipts add column if not exists updated_at timestamptz not null default now();

alter table public.hh_svc_entries add column if not exists billing_id text default '';
alter table public.hh_svc_entries add column if not exists service_name text default '';
alter table public.hh_svc_entries add column if not exists partner text default '';
alter table public.hh_svc_entries add column if not exists date text default '';
alter table public.hh_svc_entries add column if not exists freq text default '';
alter table public.hh_svc_entries add column if not exists amt numeric(12,2) not null default 0;
alter table public.hh_svc_entries add column if not exists count numeric(12,2) not null default 1;
alter table public.hh_svc_entries add column if not exists disc numeric(12,2) not null default 0;
alter table public.hh_svc_entries add column if not exists total numeric(12,2) not null default 0;
alter table public.hh_svc_entries add column if not exists remarks text default '';
alter table public.hh_svc_entries add column if not exists created_at timestamptz not null default now();
alter table public.hh_svc_entries add column if not exists updated_at timestamptz not null default now();

alter table public.hh_payout_charges add column if not exists date text default '';
alter table public.hh_payout_charges add column if not exists partner text default '';
alter table public.hh_payout_charges add column if not exists term text default '';
alter table public.hh_payout_charges add column if not exists amount numeric(12,2) not null default 0;
alter table public.hh_payout_charges add column if not exists remarks text default '';
alter table public.hh_payout_charges add column if not exists created_at timestamptz not null default now();
alter table public.hh_payout_charges add column if not exists updated_at timestamptz not null default now();

alter table public.hh_paid_transactions add column if not exists partner text default '';
alter table public.hh_paid_transactions add column if not exists paid_on text default '';
alter table public.hh_paid_transactions add column if not exists amount numeric(12,2) not null default 0;
alter table public.hh_paid_transactions add column if not exists method text default '';
alter table public.hh_paid_transactions add column if not exists photo text default '';
alter table public.hh_paid_transactions add column if not exists created_at timestamptz not null default now();
alter table public.hh_paid_transactions add column if not exists updated_at timestamptz not null default now();

alter table public.hh_roles add column if not exists created_at timestamptz not null default now();
alter table public.hh_roles add column if not exists updated_at timestamptz not null default now();
alter table public.hh_counters add column if not exists created_at timestamptz not null default now();
alter table public.hh_counters add column if not exists updated_at timestamptz not null default now();

create or replace function public.hh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hh_roles_updated_at on public.hh_roles;
create trigger hh_roles_updated_at before update on public.hh_roles for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_users_updated_at on public.hh_users;
create trigger hh_users_updated_at before update on public.hh_users for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_employees_updated_at on public.hh_employees;
create trigger hh_employees_updated_at before update on public.hh_employees for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_doctors_updated_at on public.hh_doctors;
create trigger hh_doctors_updated_at before update on public.hh_doctors for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_vendors_updated_at on public.hh_vendors;
create trigger hh_vendors_updated_at before update on public.hh_vendors for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_patients_updated_at on public.hh_patients;
create trigger hh_patients_updated_at before update on public.hh_patients for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_inquiries_updated_at on public.hh_inquiries;
create trigger hh_inquiries_updated_at before update on public.hh_inquiries for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_billings_updated_at on public.hh_billings;
create trigger hh_billings_updated_at before update on public.hh_billings for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_receipts_updated_at on public.hh_receipts;
create trigger hh_receipts_updated_at before update on public.hh_receipts for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_svc_entries_updated_at on public.hh_svc_entries;
create trigger hh_svc_entries_updated_at before update on public.hh_svc_entries for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_payout_charges_updated_at on public.hh_payout_charges;
create trigger hh_payout_charges_updated_at before update on public.hh_payout_charges for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_paid_transactions_updated_at on public.hh_paid_transactions;
create trigger hh_paid_transactions_updated_at before update on public.hh_paid_transactions for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_counters_updated_at on public.hh_counters;
create trigger hh_counters_updated_at before update on public.hh_counters for each row execute function public.hh_set_updated_at();

grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.hh_roles enable row level security;
alter table public.hh_users enable row level security;
alter table public.hh_employees enable row level security;
alter table public.hh_doctors enable row level security;
alter table public.hh_vendors enable row level security;
alter table public.hh_patients enable row level security;
alter table public.hh_inquiries enable row level security;
alter table public.hh_billings enable row level security;
alter table public.hh_receipts enable row level security;
alter table public.hh_svc_entries enable row level security;
alter table public.hh_payout_charges enable row level security;
alter table public.hh_paid_transactions enable row level security;
alter table public.hh_counters enable row level security;

create table if not exists public.hh_audit_logs (
  id text primary key,
  entity_type text not null default '',
  entity_id text not null default '',
  action text not null default '',
  stamp_text text not null default '',
  actor_user_id text not null default '',
  actor_username text not null default '',
  created text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_app_settings (
  key text primary key,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hh_employees add column if not exists score_experience text default '';
alter table public.hh_employees add column if not exists score_behaviour text default '';
alter table public.hh_employees add column if not exists score_testimonial text default '';
alter table public.hh_employees add column if not exists score_total text default '';
alter table public.hh_patients add column if not exists status_reason text default '';
alter table public.hh_patients add column if not exists status_reason_other text default '';
alter table public.hh_billings add column if not exists close_reason text default '';
alter table public.hh_billings add column if not exists close_reason_other text default '';
alter table public.hh_billings add column if not exists pause_reason text default '';

drop trigger if exists hh_audit_logs_updated_at on public.hh_audit_logs;
create trigger hh_audit_logs_updated_at before update on public.hh_audit_logs for each row execute function public.hh_set_updated_at();
drop trigger if exists hh_app_settings_updated_at on public.hh_app_settings;
create trigger hh_app_settings_updated_at before update on public.hh_app_settings for each row execute function public.hh_set_updated_at();

grant select, insert, update, delete on public.hh_audit_logs to authenticated;
grant select, insert, update, delete on public.hh_app_settings to authenticated;

create or replace function public.hh_auth_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.hh_is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.hh_users u
    where lower(coalesce(u.email, '')) = public.hh_auth_email()
      and coalesce(u.is_active, false) = true
  )
$$;

create or replace function public.hh_lookup_login(login_input text)
returns table(email text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(u.email, '')) as email, u.username
  from public.hh_users u
  where coalesce(u.is_active, false) = true
    and (
      lower(u.username) = lower(trim(coalesce(login_input, '')))
      or lower(coalesce(u.email, '')) = lower(trim(coalesce(login_input, '')))
    )
  limit 1
$$;

create or replace function public.hh_current_app_user()
returns table(
  id text,
  username text,
  email text,
  phone text,
  role text,
  is_active boolean,
  created text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.username,
    lower(coalesce(u.email, '')) as email,
    u.phone,
    u.role,
    u.is_active,
    u.created
  from public.hh_users u
  where lower(coalesce(u.email, '')) = public.hh_auth_email()
    and coalesce(u.is_active, false) = true
  limit 1
$$;

grant execute on function public.hh_lookup_login(text) to anon, authenticated;
grant execute on function public.hh_current_app_user() to authenticated;
grant execute on function public.hh_is_active_app_user() to authenticated;

alter table public.hh_audit_logs enable row level security;
alter table public.hh_app_settings enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hh_roles',
    'hh_users',
    'hh_employees',
    'hh_doctors',
    'hh_vendors',
    'hh_patients',
    'hh_inquiries',
    'hh_billings',
    'hh_receipts',
    'hh_svc_entries',
    'hh_payout_charges',
    'hh_paid_transactions',
    'hh_counters',
    'hh_audit_logs',
    'hh_app_settings'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'drop policy if exists %I on public.%I',
        table_name || '_public_access',
        table_name
      );
      execute format(
        'drop policy if exists %I on public.%I',
        table_name || '_authenticated_access',
        table_name
      );
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.hh_is_active_app_user()) with check (public.hh_is_active_app_user())',
        table_name || '_authenticated_access',
        table_name
      );
    end if;
  end loop;
end
$$;

insert into public.hh_counters (key, value)
values
  ('user', 1),
  ('emp', 1),
  ('doc', 1),
  ('vend', 1),
  ('pat', 128),
  ('bill', 80),
  ('receipt', 100),
  ('paidtx', 61),
  ('inq', 1)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();

commit;
