-- Hominal Healthcare CRM
-- Bulk, idempotent duty-calendar -> billing/payout materialization.
--
-- Purpose:
-- The previous Vercel cron walked duties one-by-one through TypeScript. On
-- production data that made some open-ended duties miss daily hh_svc_entries
-- and hh_payout_charges rows. This RPC materializes a bounded date range in
-- one database transaction and lets unique indexes prevent duplicates.

begin;

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

  create temporary table if not exists pg_temp.hh_due_duty_day_rows (
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
    svc_key text not null,
    remarks text not null
  ) on commit drop;

  truncate table pg_temp.hh_due_duty_day_rows;

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
          where coalesce(s.remarks, '') =
            ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || coalesce(d.employee_id, ''))
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
      partner.payout_term
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
    left join public.hh_employees e on e.id = partner.employee_id
    where partner.employee_id <> ''
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
    svc_key,
    billing_id,
    service_name,
    employee_name,
    employee_id,
    service_day,
    shift_type,
    charge_per_day,
    1,
    0,
    greatest(0, charge_per_day),
    remarks,
    p_actor,
    p_actor
  from pg_temp.hh_due_duty_day_rows
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

commit;
