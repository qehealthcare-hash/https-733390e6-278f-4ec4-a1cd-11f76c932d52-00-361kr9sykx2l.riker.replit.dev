-- Phase 5 — audit-pass fixes for Hominal Healthcare CRM
-- SAFE / ADDITIVE ONLY.  No DROP TABLE, no TRUNCATE, no data deletion.
-- Apply AFTER 011_phase3_rls_rpc.sql and 012_phase4_api_modules.sql.
-- Idempotent: safe to re-run.

begin;

-- C1: missing columns on hh_inquiries and hh_patients (server inserts fields the table did not have)
alter table if exists public.hh_inquiries
  add column if not exists address text default '',
  add column if not exists remarks text default '',
  add column if not exists email text default '';

alter table if exists public.hh_patients
  add column if not exists caretaker_id text,
  add column if not exists shift text default '';

create index if not exists idx_hh_patients_caretaker on public.hh_patients (caretaker_id);
create index if not exists idx_hh_inquiries_phone on public.hh_inquiries (lower(coalesce(phone, '')));

-- C2: audit trigger — coalesce updated_by, capture v_after after stamps, never overwrite explicit actor
create or replace function public.hh_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_module text := tg_argv[0];
  v_entity text;
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  v_action := lower(tg_op);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.hh_current_actor());
    new.updated_by := coalesce(new.updated_by, new.created_by, public.hh_current_actor());
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    new.updated_by := coalesce(nullif(new.updated_by, old.updated_by), public.hh_current_actor());
    new.updated_at := now();
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_entity := coalesce(old.id::text, '');
  end if;
  insert into public.hh_audit_logs(module, entity_id, action, actor, before, after, stamp)
  values (v_module, v_entity, v_action, public.hh_current_actor(), v_before, v_after, now()::text);
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- M2 + M3: payout recompute must match employee via partner column and use the period's gross/duties
create or replace function public.hh_recompute_payout(p_employee_id text, p_period text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_hours numeric := 0;
  v_count integer := 0;
  v_gross numeric := 0;
  v_existing public.hh_payouts%rowtype;
begin
  if p_employee_id is null or p_period is null then
    raise exception 'employee_id and period are required';
  end if;

  select count(*), coalesce(sum(hours), 0)
  into v_count, v_hours
  from public.hh_attendance a
  where a.employee_id = p_employee_id
    and to_char(coalesce(a.check_in_at, a.created_at, now()), 'YYYY-MM') = p_period
    and a.status = 'PRESENT';

  -- Prefer explicit partner match; fall back to remarks substring only when partner column is empty.
  select coalesce(sum(amount), 0)
  into v_gross
  from public.hh_payout_charges
  where (
    partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and (
    to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
    or substr(coalesce(date, ''), 1, 7) = p_period
  );

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period;

  if found then
    update public.hh_payouts
    set gross_amount = v_gross,
        duty_count = v_count,
        hours = v_hours,
        net_amount = v_gross + coalesce(bonus, 0) - coalesce(advance, 0) - coalesce(deduction, 0),
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD') || lpad((floor(random() * 99999))::int::text, 5, '0');
    insert into public.hh_payouts (
      id, employee_id, period_month, gross_amount, duty_count, hours, net_amount, created_by, updated_by
    ) values (
      v_id, p_employee_id, p_period, v_gross, v_count, v_hours, v_gross,
      public.hh_current_actor(), public.hh_current_actor()
    );
  end if;

  return jsonb_build_object(
    'payout_id', v_id,
    'gross', v_gross,
    'duties', v_count,
    'hours', v_hours,
    'period', p_period,
    'employee_id', p_employee_id
  );
end;
$$;

grant execute on function public.hh_recompute_payout(text, text) to authenticated;

-- H4 helper: idempotency log (keyed by Idempotency-Key + actor)
create table if not exists public.hh_idempotency (
  key text not null,
  actor text not null,
  route text not null,
  response jsonb,
  status integer default 200,
  created_at timestamptz not null default now(),
  primary key (key, actor)
);

create index if not exists idx_hh_idempotency_created on public.hh_idempotency (created_at desc);

alter table if exists public.hh_idempotency enable row level security;
drop policy if exists hh_idempotency_authenticated_access on public.hh_idempotency;
create policy hh_idempotency_authenticated_access on public.hh_idempotency
  for all to authenticated
  using (public.hh_is_active_app_user())
  with check (public.hh_is_active_app_user());

-- Refresh employee lookups view (read-only convenience)
create or replace view public.hh_employee_lookup as
  select id,
         trim(both ' ' from concat_ws(' ', coalesce(fn, ''), coalesce(mn, ''), coalesce(ln, ''))) as full_name,
         coalesce(phone, '') as phone,
         coalesce(email, '') as email,
         coalesce(dept, '') as department,
         coalesce(desig, '') as designation,
         coalesce(emp_type, etype, '') as employee_type,
         coalesce(shift, '') as default_shift
  from public.hh_employees;

grant select on public.hh_employee_lookup to authenticated;

create or replace view public.hh_patient_lookup as
  select id,
         coalesce(name, '') as name,
         coalesce(phone, '') as phone,
         coalesce(area, '') as area,
         coalesce(city, '') as city,
         coalesce(status, 'Active') as status
  from public.hh_patients;

grant select on public.hh_patient_lookup to authenticated;

commit;
