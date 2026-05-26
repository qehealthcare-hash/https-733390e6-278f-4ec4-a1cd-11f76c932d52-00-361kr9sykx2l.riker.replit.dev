-- Payout 100 fix: align charge matching with duty diary (partner_id + partner name).
-- Diary rows set partner = display name, partner_id = employee id (dutyDiaryRules).
-- Apply after 041. Safe to re-run.

begin;

-- Shared charge filter: match employee by id column OR legacy partner/remarks fallbacks.
create or replace function public.hh_employee_pending_payout(
  p_employee_id text,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged numeric := 0;
  v_paid numeric := 0;
  v_duty_count integer := 0;
begin
  if p_employee_id is null or p_employee_id = '' then
    raise exception 'employee_id is required';
  end if;
  if p_period is null or p_period = '' then
    raise exception 'period is required (YYYY-MM)';
  end if;

  select
    coalesce(sum(amount), 0),
    count(*)
  into v_charged, v_duty_count
  from public.hh_payout_charges
  where (
    partner_id = p_employee_id
    or partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and (
    substr(coalesce(date, ''), 1, 7) = p_period
    or to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
  );

  select coalesce(sum(amount), 0)
  into v_paid
  from public.hh_paid_transactions
  where (
    employee_id = p_employee_id
    or (coalesce(employee_id, '') = '' and partner = p_employee_id)
  )
  and (
    period_month = p_period
    or (
      coalesce(period_month, '') = ''
      and paid_on ~ '^\d{4}-\d{2}-\d{2}'
      and to_char(paid_on::date, 'YYYY-MM') = p_period
    )
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'period_month', p_period,
    'charged', v_charged,
    'paid', v_paid,
    'pending', greatest(v_charged - v_paid, 0),
    'duty_count', v_duty_count
  );
end;
$$;

grant execute on function public.hh_employee_pending_payout(text, text) to authenticated;

-- Recompute gross from the same charge keys attendance already uses.
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
    partner_id = p_employee_id
    or partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and (
    substr(coalesce(date, ''), 1, 7) = p_period
    or to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
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

commit;
