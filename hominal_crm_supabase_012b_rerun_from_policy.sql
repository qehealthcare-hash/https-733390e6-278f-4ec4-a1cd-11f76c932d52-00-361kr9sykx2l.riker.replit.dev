-- Run this ONLY if 012 failed with:
--   policy "hh_payouts_role_write" for table "hh_payouts" already exists
--
-- Safe to re-run. Does not delete data. Then re-run the rest of 012 from
-- "-- Lock down payout edits" onward, OR re-run the full updated 012 file.

begin;

drop policy if exists hh_payouts_auth_write on public.hh_payouts;
drop policy if exists hh_payouts_role_write on public.hh_payouts;

create policy hh_payouts_role_write on public.hh_payouts
  for all to authenticated
  using (public.hh_has_role(array['Admin','Accountant','Manager']))
  with check (public.hh_has_role(array['Admin','Accountant','Manager']));

-- ── G) Realtime (skip if already added) ─────────────────────────────────────
alter table if exists public.hh_duties replica identity full;
alter table if exists public.hh_attendance replica identity full;
alter table if exists public.hh_payouts replica identity full;
alter table if exists public.hh_whatsapp_messages replica identity full;

do $$
declare t text;
begin
  foreach t in array array[
    'hh_duties','hh_attendance','hh_payouts','hh_whatsapp_messages'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── H–J) RPCs (create or replace — safe on re-run) ───────────────────────────
create or replace function public.hh_convert_inquiry_to_patient(p_inquiry_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inq public.hh_inquiries%rowtype;
  v_pat public.hh_patients%rowtype;
  v_new_id text;
begin
  select * into v_inq from public.hh_inquiries where id = p_inquiry_id;
  if not found then raise exception 'inquiry % not found', p_inquiry_id; end if;

  select * into v_pat
  from public.hh_patients
  where coalesce(phone,'') <> '' and lower(coalesce(phone,'')) = lower(coalesce(v_inq.phone,''))
  limit 1;

  if found then
    v_new_id := v_pat.id;
  else
    v_new_id := 'P' || to_char(now(), 'YYMMDD') || lpad((floor(random()*9999))::int::text, 4, '0');
    insert into public.hh_patients (
      id, name, phone, addr, area, city, status, created, created_at, updated_at, created_by, updated_by
    ) values (
      v_new_id,
      coalesce(v_inq.name, ''),
      coalesce(v_inq.phone, ''),
      coalesce(v_inq.address, ''),
      coalesce(v_inq.area, ''),
      coalesce(v_inq.city, 'Ahmedabad'),
      'Active',
      to_char(now(), 'DD Mon YYYY'),
      now(),
      now(),
      public.hh_current_actor(),
      public.hh_current_actor()
    );
  end if;

  update public.hh_inquiries
  set status = 'Converted',
      updated_by = public.hh_current_actor(),
      updated_at = now()
  where id = p_inquiry_id;

  return jsonb_build_object('patient_id', v_new_id, 'inquiry_id', p_inquiry_id);
end;
$$;

grant execute on function public.hh_convert_inquiry_to_patient(text) to authenticated;

create or replace function public.hh_billing_amount_for_shift(p_shift text, p_day_rate numeric, p_night_rate numeric, p_full_rate numeric)
returns numeric
language sql
immutable
as $$
  select case upper(coalesce(p_shift,''))
    when 'NIGHT' then coalesce(p_night_rate, 0)
    when '24H' then coalesce(p_full_rate, p_day_rate + p_night_rate, 0)
    when 'FULL' then coalesce(p_full_rate, p_day_rate + p_night_rate, 0)
    else coalesce(p_day_rate, 0)
  end
$$;

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

  select coalesce(sum(amount), 0)
  into v_gross
  from public.hh_payout_charges
  where coalesce(remarks,'') ilike '%' || p_employee_id || '%'
    and to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period;

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period;

  if found then
    update public.hh_payouts
    set gross_amount = v_gross,
        duty_count = v_count,
        hours = v_hours,
        net_amount = v_gross + coalesce(bonus,0) - coalesce(advance,0) - coalesce(deduction,0),
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD') || lpad((floor(random()*99999))::int::text, 5, '0');
    insert into public.hh_payouts (id, employee_id, period_month, gross_amount, duty_count, hours, net_amount, created_by, updated_by)
    values (v_id, p_employee_id, p_period, v_gross, v_count, v_hours, v_gross, public.hh_current_actor(), public.hh_current_actor());
  end if;

  return jsonb_build_object('payout_id', v_id, 'gross', v_gross, 'duties', v_count, 'hours', v_hours);
end;
$$;

grant execute on function public.hh_recompute_payout(text, text) to authenticated;

commit;
