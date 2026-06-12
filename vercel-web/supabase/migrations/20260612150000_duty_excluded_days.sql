-- Hominal Healthcare CRM
-- Per-day diary exclusions: operator-deleted slots persist on the duty row
-- and are honoured by materialize, repair, reconciliation, and nightly cron.

begin;

alter table public.hh_duties
  add column if not exists excluded_days jsonb not null default '[]'::jsonb;

comment on column public.hh_duties.excluded_days is
  'Operator-skipped diary slots [{date, employee_id}]. Survives sync/cron.';

create or replace function public.hominal_duty_day_excluded(
  p_excluded jsonb,
  p_day text,
  p_employee_id text
)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(p_excluded, '[]'::jsonb)) item
    where coalesce(item->>'date', '') = p_day
      and coalesce(item->>'employee_id', '') = p_employee_id
  );
$$;


create or replace function public.hominal_materialize_due_duty_days(
  p_from date default current_date,
  p_to date default current_date,
  p_limit integer default 500,
  p_actor text default 'cron@hominal.system'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, coalesce(p_from, current_date));
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_svc integer := 0;
  v_payout integer := 0;
  v_duties integer := 0;
begin
  if v_to < v_from then
    raise exception 'p_to (%) must be on/after p_from (%)', v_to, v_from;
  end if;

  drop table if exists pg_temp.hh_due_duty_day_rows;
  create temporary table pg_temp.hh_due_duty_day_rows (
    duty_id text not null,
    billing_id text not null,
    service_name text not null,
    service_day text not null,
    shift_type text not null,
    employee_id text not null,
    employee_name text not null,
    charge_per_day numeric not null,
    payout_per_day numeric not null,
    payout_term text not null,
    partner_ord integer not null,
    duty_start_at timestamptz not null,
    svc_key text not null,
    remarks text not null
  ) on commit drop;

  with active_bill as (
    select distinct on (patient_id)
      id,
      patient_id
    from public.hh_billings
    where upper(coalesce(status, '')) = 'ACTIVE'
    order by patient_id, updated_at desc nulls last, created_at desc nulls last, id desc
  ),
  candidate_duties as (
    select d.*, b.id as active_billing_id
    from public.hh_duties d
    join active_bill b on b.patient_id = d.patient_id
    where upper(coalesce(d.status, '')) in ('SCHEDULED', 'IN_PROGRESS')
      and (d.start_at at time zone 'Asia/Kolkata')::date <= v_to
      and (d.end_at at time zone 'Asia/Kolkata')::date >= v_from
      and exists (
        select 1
        from generate_series(
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
        where not exists (
          select 1
          from public.hh_svc_entries s
          where s.billing_id = b.id
            and coalesce(s.date, '') = (gs.day_at::date)::text
            and lower(coalesce(s.service_name, '')) =
                lower(coalesce(nullif(d.service_name, ''), nullif(d.service_type, ''), 'Care Taker Services'))
        )
        or not exists (
          select 1
          from public.hh_payout_charges p
          where coalesce(p.remarks, '') =
            ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || coalesce(d.employee_id, ''))
        )
      )
    order by d.start_at asc, d.id asc
    limit v_limit
  ),
  duty_days as (
    select
      d.*,
      (gs.day_at::date)::text as service_day
    from candidate_duties d
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
      coalesce(nullif(dd.service_name, ''), nullif(dd.service_type, ''), 'Care Taker Services') as service_name,
      dd.service_day,
      coalesce(nullif(dd.shift_type, ''), 'DAY') as shift_type,
      partner.employee_id,
      coalesce(
        nullif(trim(concat_ws(' ', nullif(e.fn, ''), nullif(e.mn, ''), nullif(e.ln, ''))), ''),
        partner.employee_id
      ) as employee_name,
      partner.charge_per_day,
      partner.payout_per_day,
      partner.payout_term,
      partner.ord as partner_ord,
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
      and not public.hominal_duty_day_excluded(
        coalesce(dd.excluded_days, '[]'::jsonb),
        dd.service_day,
        partner.employee_id
      )
    order by dd.id, dd.service_day, partner.employee_id, partner.ord asc
  )
  insert into pg_temp.hh_due_duty_day_rows (
    duty_id,
    billing_id,
    service_name,
    service_day,
    shift_type,
    employee_id,
    employee_name,
    charge_per_day,
    payout_per_day,
    payout_term,
    partner_ord,
    duty_start_at,
    svc_key,
    remarks
  )
  select
    duty_id,
    billing_id,
    service_name,
    service_day,
    shift_type,
    employee_id,
    employee_name,
    charge_per_day,
    payout_per_day,
    payout_term,
    partner_ord,
    duty_start_at,
    billing_id || '_' || service_name as svc_key,
    'duty:' || duty_id || ':' || service_day || ':' || employee_id as remarks
  from partner_rows;

  get diagnostics v_duties = row_count;

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
    r.svc_key,
    r.billing_id,
    r.service_name,
    r.employee_name,
    r.employee_id,
    r.service_day,
    r.shift_type,
    r.charge_per_day,
    1,
    0,
    greatest(0, r.charge_per_day),
    r.remarks,
    p_actor,
    p_actor
  from (
    select distinct on (billing_id, service_day, lower(service_name))
      *
    from pg_temp.hh_due_duty_day_rows
    order by billing_id, service_day, lower(service_name), duty_start_at desc, partner_ord asc, employee_id
  ) r
  where not exists (
    select 1
    from public.hh_svc_entries s
    where s.billing_id = r.billing_id
      and coalesce(s.date, '') = r.service_day
      and lower(coalesce(s.service_name, '')) = lower(r.service_name)
  )
  on conflict do nothing;

  get diagnostics v_svc = row_count;

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
    svc_key,
    billing_id,
    service_name,
    service_day,
    employee_name,
    employee_id,
    payout_term,
    payout_per_day,
    remarks,
    p_actor,
    p_actor
  from pg_temp.hh_due_duty_day_rows rows
  where not exists (
    select 1
    from public.hh_payouts po
    where po.employee_id = rows.employee_id
      and po.period_month = left(rows.service_day, 7)
      and upper(coalesce(po.status, '')) in ('LOCKED', 'PAID')
  )
  on conflict do nothing;

  get diagnostics v_payout = row_count;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'candidate_rows', v_duties,
    'created_svc', v_svc,
    'created_payout', v_payout
  );
end;
$$;

grant execute on function public.hominal_materialize_due_duty_days(date, date, integer, text) to authenticated;

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
      and not public.hominal_duty_day_excluded(
        coalesce(dd.excluded_days, '[]'::jsonb),
        dd.service_day,
        partner.employee_id
      )
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
      and not public.hominal_duty_day_excluded(
        coalesce(dd.excluded_days, '[]'::jsonb),
        dd.service_day::text,
        partner.employee_id
      )
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
