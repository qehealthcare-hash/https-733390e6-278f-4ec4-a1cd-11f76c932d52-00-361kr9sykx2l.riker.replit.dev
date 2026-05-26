-- Payout module: surface the "list of employees who still have unpaid amounts
-- this month" so accountants can find them without scanning every duty.
--
-- Reads from hh_payout_charges (duty calendar) + hh_paid_transactions, mirroring
-- hh_employee_pending_payout but aggregating across every employee_id in the
-- selected period.
--
-- Safe to re-run.

begin;

create or replace function public.hh_employees_pending_for_period(p_period text)
returns table (
  employee_id text,
  charged numeric,
  paid numeric,
  pending numeric,
  duty_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with charges as (
    select
      coalesce(nullif(trim(partner_id), ''), nullif(trim(partner), '')) as emp_key,
      sum(coalesce(amount, 0)) as charged,
      count(*) as duty_count
    from public.hh_payout_charges
    where coalesce(nullif(trim(partner_id), ''), nullif(trim(partner), '')) is not null
      and (
        substr(coalesce(date, ''), 1, 7) = p_period
        or to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
      )
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
        and paid_on ~ '^\d{4}-\d{2}-\d{2}'
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

grant execute on function public.hh_employees_pending_for_period(text) to authenticated;

commit;
