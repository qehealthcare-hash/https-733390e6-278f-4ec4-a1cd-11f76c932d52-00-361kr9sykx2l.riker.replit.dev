-- Hominal Healthcare CRM
-- Repair duty-calendar → billing/payout ledger drift for a date window.
--
-- Rebuilds missing svc_entries + payout_charges from live duties, removes
-- orphan duty:% rows, dedups each affected billing, and recomputes payouts.

begin;

create or replace function public.hominal_repair_duty_ledger_window(
  p_from date default date_trunc('month', current_date)::date,
  p_to date default current_date,
  p_actor text default 'ledger-repair@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_to, current_date);
  v_inserted_svc integer := 0;
  v_inserted_payout integer := 0;
  v_updated_svc integer := 0;
  v_updated_payout integer := 0;
  v_deleted_svc integer := 0;
  v_deleted_payout integer := 0;
  v_dedup jsonb := '{}'::jsonb;
  v_payout jsonb := '{}'::jsonb;
  v_billing_id text;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  create temporary table pg_temp.hh_expected_duty_days (
    duty_id text not null,
    billing_id text not null,
    patient_id text not null,
    employee_id text not null,
    service_day date not null,
    service_name text not null,
    shift_type text not null,
    employee_name text not null,
    charge_per_day numeric not null,
    payout_per_day numeric not null,
    payout_term text not null,
    duty_start_at timestamptz not null,
    remarks text not null,
    svc_key text not null
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
      coalesce(
        nullif(trim(concat_ws(' ', nullif(e.fn, ''), nullif(e.mn, ''), nullif(e.ln, ''))), ''),
        partner.employee_id
      ) as employee_name,
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
    left join public.hh_employees e on e.id = partner.employee_id
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
    employee_name,
    charge_per_day,
    payout_per_day,
    payout_term,
    duty_start_at,
    remarks,
    svc_key
  )
  select
    duty_id,
    billing_id,
    patient_id,
    employee_id,
    service_day,
    service_name,
    shift_type,
    employee_name,
    charge_per_day,
    payout_per_day,
    payout_term,
    duty_start_at,
    'duty:' || duty_id || ':' || service_day::text || ':' || employee_id,
    billing_id || '_' || service_name
  from partner_rows;

  -- Remove orphan duty:% rows that no longer match the calendar (before insert).
  with deleted as (
    delete from public.hh_svc_entries s
    where coalesce(s.remarks, '') like 'duty:%'
      and coalesce(s.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and s.date::date between v_from and v_to
      and not exists (
        select 1
        from pg_temp.hh_expected_duty_days e
        where e.remarks = coalesce(s.remarks, '')
      )
    returning id
  )
  select count(*) into v_deleted_svc from deleted;

  with deleted as (
    delete from public.hh_payout_charges p
    where coalesce(p.remarks, '') like 'duty:%'
      and coalesce(p.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and p.date::date between v_from and v_to
      and not exists (
        select 1
        from pg_temp.hh_expected_duty_days e
        where e.remarks = coalesce(p.remarks, '')
      )
    returning id
  )
  select count(*) into v_deleted_payout from deleted;

  -- Realign stale duty rows that occupy the same bill/day/service slot.
  with winners as (
    select distinct on (billing_id, service_day, lower(service_name))
      *
    from pg_temp.hh_expected_duty_days
    order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
  ),
  updated as (
    update public.hh_svc_entries s
    set remarks = w.remarks,
        partner = w.employee_name,
        partner_id = w.employee_id,
        amt = w.charge_per_day,
        total = greatest(0, w.charge_per_day),
        updated_by = p_actor
    from winners w
    where s.billing_id = w.billing_id
      and coalesce(s.date, '') = w.service_day::text
      and lower(coalesce(s.service_name, '')) = lower(w.service_name)
      and coalesce(s.remarks, '') like 'duty:%'
      and coalesce(s.remarks, '') <> w.remarks
    returning s.id
  )
  select count(*) into v_updated_svc from updated;

  with updated as (
    update public.hh_payout_charges p
    set remarks = e.remarks,
        partner = e.employee_name,
        partner_id = e.employee_id,
        amount = e.payout_per_day,
        term = e.payout_term,
        updated_by = p_actor
    from pg_temp.hh_expected_duty_days e
    where coalesce(p.svc_key, '') = e.svc_key
      and coalesce(p.date, '') = e.service_day::text
      and lower(coalesce(p.partner, '')) = lower(e.employee_name)
      and lower(coalesce(p.term, '')) = lower(e.payout_term)
      and coalesce(p.remarks, '') like 'duty:%'
      and coalesce(p.remarks, '') <> e.remarks
    returning p.id
  )
  select count(*) into v_updated_payout from updated;

  -- Insert missing patient service rows (one charge per bill/day/service).
  with winners as (
    select distinct on (billing_id, service_day, lower(service_name))
      *
    from pg_temp.hh_expected_duty_days
    order by billing_id, service_day, lower(service_name), duty_start_at desc, employee_id
  ),
  inserted as (
    insert into public.hh_svc_entries (
      svc_key,
      billing_id,
      service_name,
      partner,
      partner_id,
      date,
      freq,
      amt,
      count,
      disc,
      total,
      remarks,
      created_by,
      updated_by
    )
    select
      w.svc_key,
      w.billing_id,
      w.service_name,
      w.employee_name,
      w.employee_id,
      w.service_day::text,
      w.shift_type,
      w.charge_per_day,
      1,
      0,
      greatest(0, w.charge_per_day),
      w.remarks,
      p_actor,
      p_actor
    from winners w
    where not exists (
      select 1
      from public.hh_svc_entries s
      where coalesce(s.svc_key, '') = w.svc_key
        and coalesce(s.date, '') = w.service_day::text
        and coalesce(s.partner_id, '') = w.employee_id
        and lower(coalesce(s.service_name, '')) = lower(w.service_name)
    )
    returning id
  )
  select count(*) into v_inserted_svc from inserted;

  -- Insert missing payout charge rows.
  with inserted as (
    insert into public.hh_payout_charges (
      svc_key,
      billing_id,
      service_name,
      date,
      partner,
      partner_id,
      term,
      amount,
      remarks,
      created_by,
      updated_by
    )
    select
      e.svc_key,
      e.billing_id,
      e.service_name,
      e.service_day::text,
      e.employee_name,
      e.employee_id,
      e.payout_term,
      e.payout_per_day,
      e.remarks,
      p_actor,
      p_actor
    from pg_temp.hh_expected_duty_days e
    where not exists (
      select 1
      from public.hh_payout_charges p
      where coalesce(p.svc_key, '') = e.svc_key
        and coalesce(p.date, '') = e.service_day::text
        and lower(coalesce(p.partner, '')) = lower(e.employee_name)
        and lower(coalesce(p.term, '')) = lower(e.payout_term)
    )
    and not exists (
      select 1
      from public.hh_payouts po
      where po.employee_id = e.employee_id
        and po.period_month = to_char(e.service_day, 'YYYY-MM')
        and upper(coalesce(po.status, '')) in ('LOCKED', 'PAID')
    )
    returning id
  )
  select count(*) into v_inserted_payout from inserted;

  -- Dedup each billing touched in this window.
  for v_billing_id in
    select distinct billing_id
    from pg_temp.hh_expected_duty_days
  loop
    v_dedup := v_dedup || jsonb_build_object(
      v_billing_id,
      public.hominal_dedup_billing_diary(v_billing_id)
    );
  end loop;

  v_payout := public.hominal_recompute_payouts_from_charge_attendance(v_from, v_to, p_actor);

  insert into public.hh_audit_logs (module, entity_id, action, stamp, payload)
  values (
    'duty-ledger',
    to_char(v_from, 'YYYY-MM-DD') || ':' || to_char(v_to, 'YYYY-MM-DD'),
    'repair',
    'Duty ledger repaired by ' || p_actor || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'inserted_svc', v_inserted_svc,
      'inserted_payout', v_inserted_payout,
      'updated_svc', v_updated_svc,
      'updated_payout', v_updated_payout,
      'deleted_orphan_svc', v_deleted_svc,
      'deleted_orphan_payout', v_deleted_payout,
      'dedup', v_dedup,
      'payout', v_payout
    )
  );

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'inserted_svc', v_inserted_svc,
    'inserted_payout', v_inserted_payout,
    'updated_svc', v_updated_svc,
    'updated_payout', v_updated_payout,
    'deleted_orphan_svc', v_deleted_svc,
    'deleted_orphan_payout', v_deleted_payout,
    'dedup_billings', (select count(distinct billing_id) from pg_temp.hh_expected_duty_days),
    'payout', v_payout
  );
end;
$$;

grant execute on function public.hominal_repair_duty_ledger_window(date, date, text) to authenticated;

commit;
