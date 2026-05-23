-- Phase 32 — Patients + Employees module hardening (corporate 100).
-- Safe to re-run.

begin;

-- ── Normalised lookup columns ───────────────────────────────────────────────
alter table public.hh_patients
  add column if not exists name_key text default '';

alter table public.hh_patients
  add column if not exists phone_digits text default '';

alter table public.hh_employees
  add column if not exists name_key text default '';

alter table public.hh_employees
  add column if not exists phone_digits text default '';

update public.hh_patients
set
  name_key = lower(trim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))),
  phone_digits = right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
where name_key = '' or phone_digits = '';

update public.hh_employees
set
  name_key = lower(trim(regexp_replace(
    concat_ws(' ',
      nullif(trim(coalesce(fn, '')), ''),
      nullif(trim(coalesce(mn, '')), ''),
      nullif(trim(coalesce(ln, '')), '')
    ),
    '\s+', ' ', 'g'
  ))),
  phone_digits = right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
where name_key = '' or phone_digits = '';

-- ── Resolve duplicate active patients (keep newest updated_at) ────────────
with ranked as (
  select
    id,
    row_number() over (
      partition by phone_digits
      order by coalesce(updated_at, created_at) desc nulls last, id desc
    ) as rn
  from public.hh_patients
  where status = 'Active'
    and length(phone_digits) >= 10
)
update public.hh_patients p
set
  status = 'Closed',
  status_reason = 'Duplicate active phone (migration 032)',
  status_reason_other = '',
  updated_at = now()
from ranked r
where p.id = r.id
  and r.rn > 1;

-- ── Resolve duplicate active employees by phone (same rule) ───────────────
with ranked as (
  select
    id,
    row_number() over (
      partition by phone_digits
      order by coalesce(updated_at, created_at) desc nulls last, id desc
    ) as rn
  from public.hh_employees
  where status = 'Active'
    and length(phone_digits) >= 10
)
update public.hh_employees e
set
  status = 'Inactive',
  leave_date = coalesce(nullif(trim(leave_date), ''), to_char(now() at time zone 'utc', 'YYYY-MM-DD')),
  updated_at = now()
from ranked r
where e.id = r.id
  and r.rn > 1;

-- ── Resolve duplicate active employees by Aadhar ──────────────────────────
with ranked as (
  select
    id,
    row_number() over (
      partition by regexp_replace(coalesce(aadhar, ''), '[^0-9]', '', 'g')
      order by coalesce(updated_at, created_at) desc nulls last, id desc
    ) as rn
  from public.hh_employees
  where status = 'Active'
    and length(regexp_replace(coalesce(aadhar, ''), '[^0-9]', '', 'g')) = 12
)
update public.hh_employees e
set
  status = 'Inactive',
  leave_date = coalesce(nullif(trim(leave_date), ''), to_char(now() at time zone 'utc', 'YYYY-MM-DD')),
  updated_at = now()
from ranked r
where e.id = r.id
  and r.rn > 1;

create index if not exists idx_hh_patients_name_key_active
  on public.hh_patients (name_key)
  where status = 'Active' and name_key <> '';

create index if not exists idx_hh_employees_name_key_active
  on public.hh_employees (name_key)
  where status = 'Active' and name_key <> '';

create unique index if not exists uq_hh_patients_phone_active
  on public.hh_patients (phone_digits)
  where status = 'Active' and length(phone_digits) >= 10;

create unique index if not exists uq_hh_employees_phone_active
  on public.hh_employees (phone_digits)
  where status = 'Active' and length(phone_digits) >= 10;

create unique index if not exists uq_hh_employees_aadhar_active
  on public.hh_employees (regexp_replace(coalesce(aadhar, ''), '[^0-9]', '', 'g'))
  where status = 'Active'
    and length(regexp_replace(coalesce(aadhar, ''), '[^0-9]', '', 'g')) = 12;

-- ── Signed-download guard: path must be referenced on a CRM row ───────────
create or replace function public.crm_storage_path_in_use(p_bucket text, p_path text)
returns boolean
language sql
stable
as $$
  select case p_bucket
    when 'patient-documents' then exists (
      select 1
      from public.hh_patients p
      where (p.photo is not null and p.photo->>'path' = p_path)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(p.docs, '[]'::jsonb)) el
           where el->>'path' = p_path
         )
    )
    when 'employee-documents' then exists (
      select 1
      from public.hh_employees e
      where (e.photo is not null and e.photo->>'path' = p_path)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(e.docs, '[]'::jsonb)) el
           where el->>'path' = p_path
         )
    )
    else false
  end;
$$;

commit;
