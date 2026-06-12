-- Hominal Healthcare CRM
-- Daily duty -> attendance -> payout reconciliation guardrail.
--
-- This keeps the duty diary as the operational source of truth:
-- 1. hh_payout_charges stores one payable duty-day per employee.
-- 2. hh_attendance must have one matching PRESENT row per duty-day.
-- 3. hh_payouts gross/net must equal the duty-day payout ledger.

begin;

create or replace function public.hominal_recompute_payouts_from_charge_attendance(
  p_from date default current_date,
  p_to date default current_date,
  p_actor text default 'duty-ledger-audit@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, coalesce(p_from, current_date));
  v_updated integer := 0;
  v_inserted integer := 0;
  v_mismatch integer := 0;
  v_attendance_gap integer := 0;
  v_attendance_duplicates integer := 0;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  with charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
    group by pc.partner_id, substr(pc.date, 1, 7)
  ),
  attendance_rollup as (
    select
      a.employee_id,
      to_char(a.work_date, 'YYYY-MM') as period_month,
      count(*)::numeric as attendance_count,
      coalesce(sum(a.hours), 0)::numeric as hours
    from public.hh_attendance a
    where coalesce(a.employee_id, '') <> ''
      and a.work_date between v_from and v_to
      and a.status in ('PRESENT', 'LATE', 'HALF_DAY')
    group by a.employee_id, to_char(a.work_date, 'YYYY-MM')
  ),
  rollup as (
    select
      c.employee_id,
      c.period_month,
      c.duty_count,
      coalesce(a.hours, 0)::numeric as hours,
      c.gross_amount
    from charge_rollup c
    left join attendance_rollup a
      on a.employee_id = c.employee_id
     and a.period_month = c.period_month
  ),
  updated as (
    update public.hh_payouts p
    set gross_amount = r.gross_amount,
        duty_count = r.duty_count,
        hours = r.hours,
        net_amount = r.gross_amount + coalesce(p.bonus, 0) - coalesce(p.advance, 0) - coalesce(p.deduction, 0),
        updated_by = p_actor,
        updated_at = now()
    from rollup r
    where p.employee_id = r.employee_id
      and p.period_month = r.period_month
    returning p.id
  )
  select count(*) into v_updated from updated;

  with charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
    group by pc.partner_id, substr(pc.date, 1, 7)
  ),
  attendance_rollup as (
    select
      a.employee_id,
      to_char(a.work_date, 'YYYY-MM') as period_month,
      coalesce(sum(a.hours), 0)::numeric as hours
    from public.hh_attendance a
    where coalesce(a.employee_id, '') <> ''
      and a.work_date between v_from and v_to
      and a.status in ('PRESENT', 'LATE', 'HALF_DAY')
    group by a.employee_id, to_char(a.work_date, 'YYYY-MM')
  ),
  rollup as (
    select
      c.employee_id,
      c.period_month,
      c.duty_count,
      coalesce(a.hours, 0)::numeric as hours,
      c.gross_amount
    from charge_rollup c
    left join attendance_rollup a
      on a.employee_id = c.employee_id
     and a.period_month = c.period_month
    where not exists (
      select 1
      from public.hh_payouts p
      where p.employee_id = c.employee_id
        and p.period_month = c.period_month
    )
  ),
  inserted as (
    insert into public.hh_payouts (
      id,
      employee_id,
      period_month,
      gross_amount,
      duty_count,
      hours,
      net_amount,
      status,
      remarks,
      created_by,
      updated_by
    )
    select
      'PO' || to_char(now(), 'YYMMDD') || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      r.employee_id,
      r.period_month,
      r.gross_amount,
      r.duty_count,
      r.hours,
      r.gross_amount,
      'OPEN',
      'Auto-created from duty diary payout ledger',
      p_actor,
      p_actor
    from rollup r
    returning id
  )
  select count(*) into v_inserted from inserted;

  with charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
    group by pc.partner_id, substr(pc.date, 1, 7)
  )
  select count(*) into v_mismatch
  from charge_rollup c
  left join public.hh_payouts p
    on p.employee_id = c.employee_id
   and p.period_month = c.period_month
  where round(coalesce(p.gross_amount, 0)::numeric, 2) <> round(c.gross_amount, 2);

  with charge_days as (
    select distinct
      nullif(split_part(pc.remarks, ':', 2), '') as duty_id,
      pc.partner_id as employee_id,
      pc.date::date as work_date
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.remarks, '') like 'duty:%'
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
      and nullif(split_part(pc.remarks, ':', 2), '') is not null
  )
  select count(*) into v_attendance_gap
  from charge_days c
  where not exists (
    select 1
    from public.hh_attendance a
    where a.duty_id = c.duty_id
      and a.employee_id = c.employee_id
      and a.work_date = c.work_date
      and a.status in ('PRESENT', 'LATE', 'HALF_DAY')
  );

  select count(*) into v_attendance_duplicates
  from (
    select duty_id, employee_id, work_date
    from public.hh_attendance
    where duty_id is not null
      and coalesce(employee_id, '') <> ''
      and work_date between v_from and v_to
    group by duty_id, employee_id, work_date
    having count(*) > 1
  ) d;

  insert into public.hh_audit_logs (module, entity_id, action, stamp, payload)
  values (
    'duty-ledger',
    to_char(v_from, 'YYYY-MM-DD') || ':' || to_char(v_to, 'YYYY-MM-DD'),
    'sync',
    'Duty ledger reconciled by ' || p_actor || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'updated_payouts', v_updated,
      'inserted_payouts', v_inserted,
      'payout_gross_mismatch_groups', v_mismatch,
      'attendance_charge_gap_groups', v_attendance_gap,
      'attendance_duplicate_groups', v_attendance_duplicates
    )
  );

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'updated_payouts', v_updated,
    'inserted_payouts', v_inserted,
    'payout_gross_mismatch_groups', v_mismatch,
    'attendance_charge_gap_groups', v_attendance_gap,
    'attendance_duplicate_groups', v_attendance_duplicates
  );
end;
$$;

grant execute on function public.hominal_recompute_payouts_from_charge_attendance(date, date, text) to authenticated;

create or replace function public.hominal_sync_duty_attendance_payout(
  p_from date default current_date,
  p_to date default current_date,
  p_actor text default 'duty-ledger-audit@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_attendance jsonb;
  v_payout jsonb;
begin
  v_attendance := public.hominal_sync_attendance_from_payout_charges(p_from, p_to, p_actor);
  v_payout := public.hominal_recompute_payouts_from_charge_attendance(p_from, p_to, p_actor);

  return jsonb_build_object(
    'ok', true,
    'attendance', v_attendance,
    'payout', v_payout
  );
end;
$$;

grant execute on function public.hominal_sync_duty_attendance_payout(date, date, text) to authenticated;

commit;
