-- Hominal Healthcare CRM — Payout desync permanent fix.
--
-- ROOT CAUSE: hominal_recompute_payouts_from_charge_attendance() rolled up
-- hh_payout_charges ONLY for rows whose `date` fell inside [p_from, p_to], then
-- OVERWROTE hh_payouts.gross_amount / duty_count with that windowed sum. The
-- daily cron calls it with p_from = p_to = today, so every night it clobbered
-- the *current month's* aggregate down to a single day's value. Open-ended
-- duties materialised into a new month showed "1 duty / 1-day amount" on the
-- Payout page while the duty calendar (live charge ledger) correctly showed the
-- full month — the exact Hiruben Keshabhai Chavda (2026-06) symptom and 40
-- desynced employee-months in production.
--
-- FIX: keep the window as a *selector* of which months to refresh, but always
-- recompute each affected (employee, period_month) from ALL charges in that
-- whole calendar month. hh_payout_charges (materialised from the duty calendar)
-- remains the single source of truth. PAID payouts are never touched.

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
  v_duplicate_charges integer := 0;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  -- (employee, period_month) refreshed from the FULL month, for every month
  -- that has at least one charge inside the [v_from, v_to] window.
  with affected_months as (
    select distinct substr(pc.date, 1, 7) as period_month
    from public.hh_payout_charges pc
    where coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
  ),
  charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount,
      coalesce(sum(public.hh_reconciliation_hours_for_term(pc.term)), 0)::numeric as hours
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and substr(pc.date, 1, 7) in (select period_month from affected_months)
    group by pc.partner_id, substr(pc.date, 1, 7)
  ),
  updated as (
    update public.hh_payouts p
    set gross_amount = r.gross_amount,
        duty_count = r.duty_count,
        hours = r.hours,
        net_amount = r.gross_amount,
        updated_by = p_actor,
        updated_at = now()
    from charge_rollup r
    where p.employee_id = r.employee_id
      and p.period_month = r.period_month
      and upper(coalesce(p.status, '')) <> 'PAID'
    returning p.id
  )
  select count(*) into v_updated from updated;

  with affected_months as (
    select distinct substr(pc.date, 1, 7) as period_month
    from public.hh_payout_charges pc
    where coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
  ),
  charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount,
      coalesce(sum(public.hh_reconciliation_hours_for_term(pc.term)), 0)::numeric as hours
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and substr(pc.date, 1, 7) in (select period_month from affected_months)
    group by pc.partner_id, substr(pc.date, 1, 7)
  ),
  missing as (
    select r.*
    from charge_rollup r
    where not exists (
      select 1
      from public.hh_payouts p
      where p.employee_id = r.employee_id
        and p.period_month = r.period_month
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
      m.employee_id,
      m.period_month,
      m.gross_amount,
      m.duty_count,
      m.hours,
      m.gross_amount,
      'OPEN',
      'Auto-created from duty-calendar payout ledger',
      p_actor,
      p_actor
    from missing m
    returning id
  )
  select count(*) into v_inserted from inserted;

  with affected_months as (
    select distinct substr(pc.date, 1, 7) as period_month
    from public.hh_payout_charges pc
    where coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
  ),
  charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and substr(pc.date, 1, 7) in (select period_month from affected_months)
    group by pc.partner_id, substr(pc.date, 1, 7)
  )
  select count(*) into v_mismatch
  from charge_rollup c
  left join public.hh_payouts p
    on p.employee_id = c.employee_id
   and p.period_month = c.period_month
  where upper(coalesce(p.status, '')) <> 'PAID'
    and round(coalesce(p.gross_amount, 0)::numeric, 2) <> round(c.gross_amount, 2);

  select count(*) into v_duplicate_charges
  from (
    select coalesce(remarks, '') as remarks, count(*) as n
    from public.hh_payout_charges
    where coalesce(remarks, '') like 'duty:%'
      and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and date::date between v_from and v_to
    group by coalesce(remarks, '')
    having count(*) > 1
  ) d;

  insert into public.hh_audit_logs (module, entity_id, action, stamp, payload)
  values (
    'duty-ledger',
    to_char(v_from, 'YYYY-MM-DD') || ':' || to_char(v_to, 'YYYY-MM-DD'),
    'sync',
    'Duty-calendar payout ledger reconciled (full-month) by ' || p_actor || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'updated_payouts', v_updated,
      'inserted_payouts', v_inserted,
      'payout_gross_mismatch_groups', v_mismatch,
      'duplicate_payout_charge_groups', v_duplicate_charges,
      'rule', 'payout = full-month sum of hh_payout_charges; window selects months only'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'updated_payouts', v_updated,
    'inserted_payouts', v_inserted,
    'payout_gross_mismatch_groups', v_mismatch,
    'duplicate_payout_charge_groups', v_duplicate_charges
  );
end;
$$;

commit;
