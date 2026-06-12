-- Hominal Healthcare CRM
-- Fix reconciliation billing comparison: patient billing charges ONE service
-- row per bill/day/service (latest-started duty wins on handovers). The prior
-- report summed every duty-day × partner row, which double-counted overlapping
-- open-ended duties and produced false patient billing mismatches.

begin;

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
  v_expected_billing_slots integer := 0;
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
    duty_start_at timestamptz not null,
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
      coalesce(nullif(partner.payout_term, ''), 'Daily') as payout_term,
      dd.start_at as duty_start_at
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
          case when coalesce(item->>'charge_per_day', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then (item->>'charge_per_day')::numeric
          end,
          dd.charge_per_day,
          0
        ) as charge_per_day,
        coalesce(
          case when coalesce(item->>'payout_per_day', '') ~ '^[0-9]+(\.[0-9]+)?$'
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
    duty_start_at,
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
    duty_start_at,
    'duty:' || duty_id || ':' || service_day::text || ':' || employee_id
  from partner_rows;

  select count(*) into v_expected_rows from pg_temp.hh_expected_duty_days;

  select count(*), coalesce(sum(charge_per_day), 0)
    into v_expected_billing_slots, v_expected_bill_amount
  from (
    select distinct on (billing_id, service_day, lower(service_name))
      charge_per_day
    from pg_temp.hh_expected_duty_days
    order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
  ) billing_winners;

  select coalesce(sum(payout_per_day), 0)
    into v_expected_payout_amount
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

  -- Billing: one svc row per bill/day/service (not per duty remark).
  select count(*) into v_missing_service
  from (
    select distinct on (billing_id, service_day, lower(service_name))
      billing_id,
      service_day,
      service_name
    from pg_temp.hh_expected_duty_days
    order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
  ) w
  where not exists (
    select 1
    from public.hh_svc_entries s
    where s.billing_id = w.billing_id
      and coalesce(s.date, '') = w.service_day::text
      and lower(coalesce(s.service_name, '')) = lower(w.service_name)
      and coalesce(s.remarks, '') like 'duty:%'
  );

  -- Payout: one charge per duty/day/employee remark.
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
      select 1
      from (
        select distinct on (billing_id, service_day, lower(service_name))
          billing_id,
          service_day,
          service_name
        from pg_temp.hh_expected_duty_days
        order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
      ) w
      where w.billing_id = s.billing_id
        and w.service_day::text = coalesce(s.date, '')
        and lower(w.service_name) = lower(coalesce(s.service_name, ''))
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

  with billing_winners as (
    select distinct on (billing_id, service_day, lower(service_name))
      patient_id,
      billing_id,
      service_day,
      service_name,
      charge_per_day
    from pg_temp.hh_expected_duty_days
    order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
  ),
  expected as (
    select patient_id, sum(charge_per_day)::numeric as expected_amount
    from billing_winners
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
      'Billing expected = one charge per bill/day/service (latest duty wins)',
      'Payout expected = one charge per duty/day/employee remark',
      'Billing is read-only from duty-calendar materialized service rows',
      'Payout is read-only from duty-calendar materialized payout rows',
      'Manual edits must not alter calculated amounts'
    ),
    'summary', jsonb_build_object(
      'expected_duty_day_rows', v_expected_rows,
      'expected_billing_slots', v_expected_billing_slots,
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

grant execute on function public.hominal_duty_reconciliation_report(date, date, text) to authenticated;

commit;
