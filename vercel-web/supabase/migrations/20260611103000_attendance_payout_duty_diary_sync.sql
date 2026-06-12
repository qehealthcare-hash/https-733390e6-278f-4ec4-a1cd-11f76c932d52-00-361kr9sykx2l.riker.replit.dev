-- Hominal Healthcare CRM
-- Attendance + payout synchronization hardening.
--
-- Root fix:
-- 1. Multi-day duties need one attendance row per duty/employee/work_date,
--    not one row for the entire duty.
-- 2. Payout recompute must use payout charge date as the month source of
--    truth; created_at fallback can pull old duties into the wrong month.
-- 3. Backfill attendance from the already-synchronized payout duty diary.

begin;

drop index if exists public.uq_hh_attendance_duty_employee;

create unique index if not exists uq_hh_attendance_duty_employee_work_date
  on public.hh_attendance (duty_id, employee_id, work_date)
  where duty_id is not null
    and coalesce(employee_id, '') <> ''
    and work_date is not null;

create index if not exists idx_hh_attendance_employee_work_date
  on public.hh_attendance (employee_id, work_date);

create or replace function public.hominal_attendance_hours_for_shift(p_shift text)
returns numeric
language sql
immutable
as $$
  select case
    when upper(coalesce(p_shift, '')) in ('24H', '24HR', '24 HOURS', '24 HOURS SHIFT', 'FULL') then 24
    when upper(coalesce(p_shift, '')) in ('NIGHT', 'NIGHT SHIFT') then 12
    when upper(coalesce(p_shift, '')) in ('DAY', 'DAY SHIFT') then 10
    else 10
  end::numeric;
$$;

create or replace function public.hominal_sync_attendance_from_payout_charges(
  p_from date default current_date,
  p_to date default current_date,
  p_actor text default 'duty-diary-sync@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, coalesce(p_from, current_date));
  v_inserted integer := 0;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  with source_rows as (
    select distinct on (
      nullif(split_part(pc.remarks, ':', 2), ''),
      pc.partner_id,
      pc.date
    )
      nullif(split_part(pc.remarks, ':', 2), '') as duty_id,
      pc.partner_id as employee_id,
      b.patient_id,
      pc.date::date as work_date,
      coalesce(nullif(pc.service_name, ''), nullif(d.service_name, ''), nullif(d.service_type, '')) as service_name,
      coalesce(nullif(d.shift_type, ''), nullif(pc.term, '')) as shift_type,
      public.hominal_attendance_hours_for_shift(coalesce(nullif(d.shift_type, ''), nullif(pc.term, ''))) as hours
    from public.hh_payout_charges pc
    left join public.hh_duties d on d.id = nullif(split_part(pc.remarks, ':', 2), '')
    left join public.hh_billings b on b.id = pc.billing_id
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.remarks, '') like 'duty:%'
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
      and nullif(split_part(pc.remarks, ':', 2), '') is not null
    order by
      nullif(split_part(pc.remarks, ':', 2), ''),
      pc.partner_id,
      pc.date,
      pc.created_at asc nulls last,
      pc.id asc
  )
  insert into public.hh_attendance (
    id,
    duty_id,
    employee_id,
    patient_id,
    check_in_at,
    check_out_at,
    hours,
    status,
    remarks,
    created_by,
    updated_by,
    shift_type,
    work_date
  )
  select
    'AT' || replace(gen_random_uuid()::text, '-', ''),
    s.duty_id,
    s.employee_id,
    s.patient_id,
    null,
    null,
    s.hours,
    'PRESENT',
    'Auto-synced from duty diary payout charge',
    p_actor,
    p_actor,
    s.shift_type,
    s.work_date
  from source_rows s
  where not exists (
    select 1
    from public.hh_attendance a
    where a.duty_id = s.duty_id
      and a.employee_id = s.employee_id
      and a.work_date = s.work_date
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'inserted_attendance', v_inserted
  );
end;
$$;

grant execute on function public.hominal_sync_attendance_from_payout_charges(date, date, text) to authenticated;

create or replace function public.hh_recompute_payout(p_employee_id text, p_period text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id text;
  v_hours numeric := 0;
  v_count integer := 0;
  v_gross numeric := 0;
  v_existing public.hh_payouts%rowtype;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager','Staff','Nurse']);
  if p_employee_id is null or p_period is null then
    raise exception 'employee_id and period are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('payout:' || p_employee_id || ':' || p_period));

  select count(*), coalesce(sum(hours), 0)
  into v_count, v_hours
  from public.hh_attendance a
  where a.employee_id = p_employee_id
    and to_char(
      coalesce(
        a.work_date,
        (coalesce(a.check_in_at, a.updated_at, a.created_at, now()) at time zone 'Asia/Kolkata')::date
      ),
      'YYYY-MM'
    ) = p_period
    and a.status in ('PRESENT', 'LATE', 'HALF_DAY');

  select coalesce(sum(amount), 0)
  into v_gross
  from public.hh_payout_charges
  where (
    partner_id = p_employee_id
    or partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and substr(coalesce(date, ''), 1, 7) = p_period;

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period
  for update;

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

commit;
