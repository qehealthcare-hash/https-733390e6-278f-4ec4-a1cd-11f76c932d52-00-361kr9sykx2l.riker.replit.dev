-- Attendance module hardening (corporate audit → 100)
-- - Per (duty, employee) uniqueness (relief / extra-partner marks)
-- - shift_type + work_date columns
-- - status CHECK + HALF → HALF_DAY backfill
-- - Payout RPC: LATE / HALF_DAY hours + work_date period bucketing

-- 1. Columns
alter table public.hh_attendance
  add column if not exists shift_type text,
  add column if not exists work_date date;

-- 2. Backfill work_date (IST calendar day)
update public.hh_attendance
set work_date = (coalesce(check_in_at, updated_at, created_at) at time zone 'Asia/Kolkata')::date
where work_date is null;

-- 3. Legacy status normalisation
update public.hh_attendance
set status = 'HALF_DAY'
where upper(coalesce(status, '')) = 'HALF';

-- 4. Replace one-row-per-duty unique index with per-partner index
drop index if exists public.uq_hh_attendance_per_duty;

create unique index if not exists uq_hh_attendance_duty_employee
  on public.hh_attendance (duty_id, employee_id)
  where duty_id is not null and coalesce(employee_id, '') <> '';

-- 5. Status constraint (idempotent)
alter table public.hh_attendance
  drop constraint if exists chk_hh_attendance_status;

alter table public.hh_attendance
  add constraint chk_hh_attendance_status
  check (
    status in ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY')
  );

-- 6. Payout recompute — count worked statuses + IST period from work_date
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
