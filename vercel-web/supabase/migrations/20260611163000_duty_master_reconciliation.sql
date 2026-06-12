-- Hominal Healthcare CRM
-- Enterprise reconciliation: Duty Calendar is the single source of truth.
--
-- This migration intentionally does two things:
-- 1. Replaces the older payout guardrail so payouts are recomputed from
--    hh_payout_charges only. Attendance is operational evidence, not payroll
--    math, because the duty calendar materializer owns payable days.
-- 2. Adds a read-only reconciliation report RPC that compares duty-derived
--    expected rows against billing and payout ledgers for a date window.

begin;

create or replace function public.hh_reconciliation_hours_for_term(p_term text)
returns numeric
language sql
immutable
as $$
  select case
    when lower(coalesce(p_term, '')) like '%24%' then 24
    when lower(coalesce(p_term, '')) like '%night%'
      or lower(coalesce(p_term, '')) like '%8 pm%'
      or lower(coalesce(p_term, '')) like '%8:00 pm%' then 12
    when lower(coalesce(p_term, '')) like '%day%'
      or lower(coalesce(p_term, '')) like '%9 am%'
      or lower(coalesce(p_term, '')) like '%9:00 am%' then 10
    else 24
  end::numeric;
$$;

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

  with charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount,
      coalesce(sum(public.hh_reconciliation_hours_for_term(pc.term)), 0)::numeric as hours
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
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

  with charge_rollup as (
    select
      pc.partner_id as employee_id,
      substr(pc.date, 1, 7) as period_month,
      count(*)::numeric as duty_count,
      coalesce(sum(pc.amount), 0)::numeric as gross_amount,
      coalesce(sum(public.hh_reconciliation_hours_for_term(pc.term)), 0)::numeric as hours
    from public.hh_payout_charges pc
    where coalesce(pc.partner_id, '') <> ''
      and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pc.date::date between v_from and v_to
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
    'Duty-calendar payout ledger reconciled by ' || p_actor || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'updated_payouts', v_updated,
      'inserted_payouts', v_inserted,
      'payout_gross_mismatch_groups', v_mismatch,
      'duplicate_payout_charge_groups', v_duplicate_charges,
      'rule', 'payout = hh_payout_charges only'
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

create or replace function public.hominal_duty_reconciliation_report(
  p_from date default date_trunc('month', current_date)::date,
  p_to date default current_date,
  p_actor text default 'reconciliation@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_to, current_date);
  v_expected_rows integer := 0;
  v_expected_bill_amount numeric := 0;
  v_expected_payout_amount numeric := 0;
  v_service_rows integer := 0;
  v_service_amount numeric := 0;
  v_payout_rows integer := 0;
  v_payout_amount numeric := 0;
  v_missing_service integer := 0;
  v_missing_payout integer := 0;
  v_duplicate_service integer := 0;
  v_duplicate_payout integer := 0;
  v_orphan_service integer := 0;
  v_orphan_payout integer := 0;
  v_payout_mismatch integer := 0;
  v_billing_mismatch integer := 0;
  v_patient_mismatch jsonb := '[]'::jsonb;
  v_employee_mismatch jsonb := '[]'::jsonb;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  create temporary table if not exists pg_temp.hh_expected_duty_days (
    duty_id text not null,
    billing_id text not null,
    patient_id text not null,
    employee_id text not null,
    service_day date not null,
    service_name text not null,
    shift_type text not null,
    charge_per_day numeric not null,
    payout_per_day numeric not null,
    payout_term text not null,
    remarks text not null
  ) on commit drop;

  truncate table pg_temp.hh_expected_duty_days;

  with active_bill as (
    select distinct on (patient_id)
      id,
      patient_id
    from public.hh_billings
    where upper(coalesce(status, '')) = 'ACTIVE'
    order by patient_id, updated_at desc nulls last, created_at desc nulls last, id desc
  ),
  source_duties as (
    select d.*, b.id as active_billing_id
    from public.hh_duties d
    join active_bill b on b.patient_id = d.patient_id
    where upper(coalesce(d.status, '')) in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED')
      and coalesce(d.patient_id, '') <> ''
      and coalesce(d.employee_id, '') <> ''
      and (d.start_at at time zone 'Asia/Kolkata')::date <= v_to
      and (
        case
          when d.end_at >= timestamptz '2099-01-01 00:00:00+00' then v_to
          else (d.end_at at time zone 'Asia/Kolkata')::date
        end
      ) >= v_from
  ),
  duty_days as (
    select
      d.*,
      gs.day_at::date as service_day
    from source_duties d
    cross join lateral generate_series(
      greatest((d.start_at at time zone 'Asia/Kolkata')::date, v_from),
      least(
        case
          when d.end_at >= timestamptz '2099-01-01 00:00:00+00' then v_to
          else (d.end_at at time zone 'Asia/Kolkata')::date
        end,
        v_to
      ),
      interval '1 day'
    ) gs(day_at)
  ),
  partner_rows as (
    select distinct on (dd.id, dd.service_day, partner.employee_id)
      dd.id as duty_id,
      dd.active_billing_id as billing_id,
      dd.patient_id,
      partner.employee_id,
      dd.service_day,
      coalesce(nullif(dd.service_name, ''), nullif(dd.service_type, ''), 'Care Taker Services') as service_name,
      coalesce(nullif(dd.shift_type, ''), 'DAY') as shift_type,
      coalesce(partner.charge_per_day, 0)::numeric as charge_per_day,
      coalesce(partner.payout_per_day, 0)::numeric as payout_per_day,
      coalesce(nullif(partner.payout_term, ''), 'Daily') as payout_term
    from duty_days dd
    cross join lateral (
      select
        coalesce(dd.employee_id, '') as employee_id,
        coalesce(dd.charge_per_day, 0)::numeric as charge_per_day,
        coalesce(dd.payout_per_day, 0)::numeric as payout_per_day,
        coalesce(nullif(dd.payout_term, ''), 'Daily') as payout_term,
        0 as ord
      union all
      select
        coalesce(item->>'employee_id', '') as employee_id,
        coalesce(
          case when coalesce(item->>'charge_per_day', '') ~ '^[0-9]+(\\.[0-9]+)?$'
            then (item->>'charge_per_day')::numeric
          end,
          dd.charge_per_day,
          0
        ) as charge_per_day,
        coalesce(
          case when coalesce(item->>'payout_per_day', '') ~ '^[0-9]+(\\.[0-9]+)?$'
            then (item->>'payout_per_day')::numeric
          end,
          dd.payout_per_day,
          0
        ) as payout_per_day,
        coalesce(nullif(item->>'payout_term', ''), nullif(dd.payout_term, ''), 'Daily') as payout_term,
        1 as ord
      from jsonb_array_elements(coalesce(dd.extra_partners, '[]'::jsonb)) item
    ) partner
    where partner.employee_id <> ''
    order by dd.id, dd.service_day, partner.employee_id, partner.ord asc
  )
  insert into pg_temp.hh_expected_duty_days (
    duty_id,
    billing_id,
    patient_id,
    employee_id,
    service_day,
    service_name,
    shift_type,
    charge_per_day,
    payout_per_day,
    payout_term,
    remarks
  )
  select
    duty_id,
    billing_id,
    patient_id,
    employee_id,
    service_day,
    service_name,
    shift_type,
    charge_per_day,
    payout_per_day,
    payout_term,
    'duty:' || duty_id || ':' || service_day::text || ':' || employee_id
  from partner_rows;

  select count(*), coalesce(sum(charge_per_day), 0), coalesce(sum(payout_per_day), 0)
    into v_expected_rows, v_expected_bill_amount, v_expected_payout_amount
  from pg_temp.hh_expected_duty_days;

  select count(*), coalesce(sum(total), 0)
    into v_service_rows, v_service_amount
  from public.hh_svc_entries
  where coalesce(remarks, '') like 'duty:%'
    and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and date::date between v_from and v_to;

  select count(*), coalesce(sum(amount), 0)
    into v_payout_rows, v_payout_amount
  from public.hh_payout_charges
  where coalesce(remarks, '') like 'duty:%'
    and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and date::date between v_from and v_to;

  select count(*) into v_missing_service
  from pg_temp.hh_expected_duty_days e
  where not exists (
    select 1 from public.hh_svc_entries s
    where coalesce(s.remarks, '') = e.remarks
  );

  select count(*) into v_missing_payout
  from pg_temp.hh_expected_duty_days e
  where not exists (
    select 1 from public.hh_payout_charges p
    where coalesce(p.remarks, '') = e.remarks
  );

  select count(*) into v_duplicate_service
  from (
    select remarks
    from public.hh_svc_entries
    where coalesce(remarks, '') like 'duty:%'
      and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and date::date between v_from and v_to
    group by remarks
    having count(*) > 1
  ) d;

  select count(*) into v_duplicate_payout
  from (
    select remarks
    from public.hh_payout_charges
    where coalesce(remarks, '') like 'duty:%'
      and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and date::date between v_from and v_to
    group by remarks
    having count(*) > 1
  ) d;

  select count(*) into v_orphan_service
  from public.hh_svc_entries s
  where coalesce(s.remarks, '') like 'duty:%'
    and coalesce(s.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and s.date::date between v_from and v_to
    and not exists (
      select 1 from pg_temp.hh_expected_duty_days e
      where e.remarks = coalesce(s.remarks, '')
    );

  select count(*) into v_orphan_payout
  from public.hh_payout_charges p
  where coalesce(p.remarks, '') like 'duty:%'
    and coalesce(p.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and p.date::date between v_from and v_to
    and not exists (
      select 1 from pg_temp.hh_expected_duty_days e
      where e.remarks = coalesce(p.remarks, '')
    );

  with expected as (
    select patient_id, sum(charge_per_day)::numeric as expected_amount
    from pg_temp.hh_expected_duty_days
    group by patient_id
  ),
  actual as (
    select b.patient_id, sum(se.total)::numeric as actual_amount
    from public.hh_svc_entries se
    join public.hh_billings b on b.id = se.billing_id
    where coalesce(se.remarks, '') like 'duty:%'
      and coalesce(se.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and se.date::date between v_from and v_to
    group by b.patient_id
  ),
  mismatch as (
    select
      coalesce(e.patient_id, a.patient_id) as patient_id,
      coalesce(e.expected_amount, 0) as expected_amount,
      coalesce(a.actual_amount, 0) as actual_amount,
      coalesce(a.actual_amount, 0) - coalesce(e.expected_amount, 0) as difference
    from expected e
    full join actual a on a.patient_id = e.patient_id
    where round(coalesce(e.expected_amount, 0), 2) <> round(coalesce(a.actual_amount, 0), 2)
    order by abs(coalesce(a.actual_amount, 0) - coalesce(e.expected_amount, 0)) desc
    limit 50
  )
  select count(*), coalesce(jsonb_agg(to_jsonb(mismatch)), '[]'::jsonb)
    into v_billing_mismatch, v_patient_mismatch
  from mismatch;

  with expected as (
    select employee_id, sum(payout_per_day)::numeric as expected_amount
    from pg_temp.hh_expected_duty_days
    group by employee_id
  ),
  actual as (
    select partner_id as employee_id, sum(amount)::numeric as actual_amount
    from public.hh_payout_charges
    where coalesce(partner_id, '') <> ''
      and coalesce(remarks, '') like 'duty:%'
      and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and date::date between v_from and v_to
    group by partner_id
  ),
  mismatch as (
    select
      coalesce(e.employee_id, a.employee_id) as employee_id,
      coalesce(e.expected_amount, 0) as expected_amount,
      coalesce(a.actual_amount, 0) as actual_amount,
      coalesce(a.actual_amount, 0) - coalesce(e.expected_amount, 0) as difference
    from expected e
    full join actual a on a.employee_id = e.employee_id
    where round(coalesce(e.expected_amount, 0), 2) <> round(coalesce(a.actual_amount, 0), 2)
    order by abs(coalesce(a.actual_amount, 0) - coalesce(e.expected_amount, 0)) desc
    limit 50
  )
  select count(*), coalesce(jsonb_agg(to_jsonb(mismatch)), '[]'::jsonb)
    into v_payout_mismatch, v_employee_mismatch
  from mismatch;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'rules', jsonb_build_array(
      'Duty Calendar is MASTER',
      'Billing is read-only from duty-calendar materialized service rows',
      'Payout is read-only from duty-calendar materialized payout rows',
      'Reports reconcile against billing and payout ledgers',
      'Manual edits must not alter calculated amounts'
    ),
    'summary', jsonb_build_object(
      'expected_duty_day_rows', v_expected_rows,
      'expected_bill_amount', v_expected_bill_amount,
      'expected_payout_amount', v_expected_payout_amount,
      'service_rows', v_service_rows,
      'service_amount', v_service_amount,
      'payout_rows', v_payout_rows,
      'payout_amount', v_payout_amount,
      'missing_service_rows', v_missing_service,
      'missing_payout_rows', v_missing_payout,
      'duplicate_service_groups', v_duplicate_service,
      'duplicate_payout_groups', v_duplicate_payout,
      'orphan_service_rows', v_orphan_service,
      'orphan_payout_rows', v_orphan_payout,
      'patient_billing_mismatch_groups', v_billing_mismatch,
      'employee_payout_mismatch_groups', v_payout_mismatch
    ),
    'patient_billing_mismatches', v_patient_mismatch,
    'employee_payout_mismatches', v_employee_mismatch
  );
end;
$$;

grant execute on function public.hominal_recompute_payouts_from_charge_attendance(date, date, text) to authenticated;
grant execute on function public.hominal_duty_reconciliation_report(date, date, text) to authenticated;

commit;
