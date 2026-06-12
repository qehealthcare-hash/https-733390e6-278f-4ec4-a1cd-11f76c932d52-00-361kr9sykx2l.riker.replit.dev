-- Hominal Healthcare CRM
-- Payout month hardening: payouts must be grouped by actual duty date,
-- never by the date a ledger row happened to be created.

begin;

create or replace function public.hh_employee_pending_payout(p_employee_id text, p_period text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  and substr(coalesce(date, ''), 1, 7) = p_period;

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
      and paid_on ~ '^\\d{4}-\\d{2}-\\d{2}'
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

create or replace function public.hh_employees_pending_for_period(p_period text)
returns table(employee_id text, charged numeric, paid numeric, pending numeric, duty_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with charges as (
    select
      coalesce(nullif(trim(partner_id), ''), nullif(trim(partner), '')) as emp_key,
      sum(coalesce(amount, 0)) as charged,
      count(*) as duty_count
    from public.hh_payout_charges
    where coalesce(nullif(trim(partner_id), ''), nullif(trim(partner), '')) is not null
      and substr(coalesce(date, ''), 1, 7) = p_period
    group by 1
  ),
  paid as (
    select
      coalesce(nullif(trim(employee_id), ''), nullif(trim(partner), '')) as emp_key,
      sum(coalesce(amount, 0)) as paid
    from public.hh_paid_transactions
    where (
      period_month = p_period
      or (
        coalesce(period_month, '') = ''
        and paid_on ~ '^\\d{4}-\\d{2}-\\d{2}'
        and to_char(paid_on::date, 'YYYY-MM') = p_period
      )
    )
    and coalesce(nullif(trim(employee_id), ''), nullif(trim(partner), '')) is not null
    group by 1
  )
  select
    c.emp_key as employee_id,
    c.charged,
    coalesce(p.paid, 0) as paid,
    greatest(c.charged - coalesce(p.paid, 0), 0) as pending,
    c.duty_count::integer
  from charges c
  left join paid p on p.emp_key = c.emp_key
  where greatest(c.charged - coalesce(p.paid, 0), 0) > 0.005
  order by greatest(c.charged - coalesce(p.paid, 0), 0) desc;
$$;

-- Re-align currently open June payout rows with date-based duty charges.
-- This clears stale rows that were inflated by rows created in June for May duties.
with charge_rollup as (
  select
    pc.partner_id as employee_id,
    substr(pc.date, 1, 7) as period_month,
    count(*)::numeric as duty_count,
    coalesce(sum(pc.amount), 0)::numeric as gross_amount
  from public.hh_payout_charges pc
  where coalesce(pc.partner_id, '') <> ''
    and substr(coalesce(pc.date, ''), 1, 7) = '2026-06'
  group by pc.partner_id, substr(pc.date, 1, 7)
),
attendance_rollup as (
  select
    a.employee_id,
    to_char(a.work_date, 'YYYY-MM') as period_month,
    coalesce(sum(a.hours), 0)::numeric as hours
  from public.hh_attendance a
  where coalesce(a.employee_id, '') <> ''
    and to_char(a.work_date, 'YYYY-MM') = '2026-06'
    and a.status in ('PRESENT', 'LATE', 'HALF_DAY')
  group by a.employee_id, to_char(a.work_date, 'YYYY-MM')
)
update public.hh_payouts p
set gross_amount = coalesce(c.gross_amount, 0),
    duty_count = coalesce(c.duty_count, 0),
    hours = coalesce(a.hours, 0),
    net_amount = coalesce(c.gross_amount, 0) + coalesce(p.bonus, 0) - coalesce(p.advance, 0) - coalesce(p.deduction, 0),
    updated_by = 'payout-duty-date-hardening@hominal.system',
    updated_at = now()
from public.hh_payouts base
left join charge_rollup c
  on c.employee_id = base.employee_id
 and c.period_month = base.period_month
left join attendance_rollup a
  on a.employee_id = base.employee_id
 and a.period_month = base.period_month
where p.id = base.id
  and p.period_month = '2026-06'
  and p.status <> 'PAID';

commit;
