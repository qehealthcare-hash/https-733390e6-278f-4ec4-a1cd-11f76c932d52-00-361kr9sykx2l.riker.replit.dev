-- Hominal Healthcare CRM
-- Payout strict source-of-truth hardening.
--
-- Rule: payout totals, duty count, and hours come only from duty-calendar
-- materialized payout rows (hh_payout_charges). Attendance may exist for
-- operations, but it must not create a second payout count.

begin;

create or replace function public.hh_payout_hours_for_term(p_term text)
returns numeric
language sql
immutable
as $$
  select case
    when lower(coalesce(p_term, '')) like '%24%' then 24
    when lower(coalesce(p_term, '')) like '%night%' then 12
    when lower(coalesce(p_term, '')) like '%8:00 pm%' then 12
    when lower(coalesce(p_term, '')) like '%8 pm%' then 12
    when lower(coalesce(p_term, '')) like '%day%' then 10
    when lower(coalesce(p_term, '')) like '%9:00 am%' then 10
    when lower(coalesce(p_term, '')) like '%9 am%' then 10
    else 24
  end;
$$;

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
  if p_employee_id is null or btrim(p_employee_id) = '' or p_period is null or btrim(p_period) = '' then
    raise exception 'employee_id and period are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('payout:' || p_employee_id || ':' || p_period));

  select
    count(*)::integer,
    coalesce(sum(public.hh_payout_hours_for_term(coalesce(term, ''))), 0),
    coalesce(sum(amount), 0)
  into v_count, v_hours, v_gross
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
        net_amount = greatest(v_gross + coalesce(bonus, 0) - coalesce(advance, 0) - coalesce(deduction, 0), 0),
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD')
      || lpad((abs(hashtext(gen_random_uuid()::text)) % 100000)::text, 5, '0');
    insert into public.hh_payouts (
      id, employee_id, period_month, gross_amount, duty_count, hours,
      net_amount, created_by, updated_by
    ) values (
      v_id, p_employee_id, p_period, v_gross, v_count, v_hours,
      v_gross, public.hh_current_actor(), public.hh_current_actor()
    );
  end if;

  return jsonb_build_object(
    'payout_id', v_id,
    'gross', v_gross,
    'duties', v_count,
    'hours', v_hours,
    'period', p_period,
    'employee_id', p_employee_id,
    'source', 'hh_payout_charges'
  );
end;
$$;

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
  v_hours numeric := 0;
begin
  if p_employee_id is null or btrim(p_employee_id) = '' then
    raise exception 'employee_id is required';
  end if;
  if p_period is null or btrim(p_period) = '' then
    raise exception 'period is required (YYYY-MM)';
  end if;

  select
    coalesce(sum(amount), 0),
    count(*)::integer,
    coalesce(sum(public.hh_payout_hours_for_term(coalesce(term, ''))), 0)
  into v_charged, v_duty_count, v_hours
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
    'duty_count', v_duty_count,
    'hours', v_hours
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
      count(*)::integer as duty_count
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
    c.duty_count
  from charges c
  left join paid p on p.emp_key = c.emp_key
  where greatest(c.charged - coalesce(p.paid, 0), 0) > 0.005
  order by greatest(c.charged - coalesce(p.paid, 0), 0) desc;
$$;

-- Realign all non-paid payout rows so the stored ledger matches the strict
-- duty-calendar source immediately after this migration.
with charge_rollup as (
  select
    coalesce(nullif(trim(pc.partner_id), ''), nullif(trim(pc.partner), '')) as employee_id,
    substr(pc.date, 1, 7) as period_month,
    count(*)::numeric as duty_count,
    coalesce(sum(public.hh_payout_hours_for_term(coalesce(pc.term, ''))), 0)::numeric as hours,
    coalesce(sum(pc.amount), 0)::numeric as gross_amount
  from public.hh_payout_charges pc
  where coalesce(nullif(trim(pc.partner_id), ''), nullif(trim(pc.partner), '')) is not null
    and coalesce(pc.date, '') <> ''
  group by 1, 2
)
update public.hh_payouts p
set gross_amount = coalesce(c.gross_amount, 0),
    duty_count = coalesce(c.duty_count, 0),
    hours = coalesce(c.hours, 0),
    net_amount = greatest(coalesce(c.gross_amount, 0) + coalesce(p.bonus, 0) - coalesce(p.advance, 0) - coalesce(p.deduction, 0), 0),
    updated_by = 'payout-strict-duty-calendar@hominal.system',
    updated_at = now()
from public.hh_payouts base
left join charge_rollup c
  on c.employee_id = base.employee_id
 and c.period_month = base.period_month
where p.id = base.id
  and p.status <> 'PAID';

grant execute on function public.hh_payout_hours_for_term(text) to authenticated;
grant execute on function public.hh_recompute_payout(text, text) to authenticated;
grant execute on function public.hh_employee_pending_payout(text, text) to authenticated;
grant execute on function public.hh_employees_pending_for_period(text) to authenticated;

commit;
