-- Phase 1 SSOT: never overwrite LOCKED or PAID payout aggregates from recompute RPCs.

begin;

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

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period
  for update;

  if found and upper(coalesce(v_existing.status, '')) in ('LOCKED', 'PAID') then
    return jsonb_build_object(
      'payout_id', v_existing.id,
      'gross', v_existing.gross_amount,
      'duties', v_existing.duty_count,
      'hours', v_existing.hours,
      'period', p_period,
      'employee_id', p_employee_id,
      'source', 'hh_payout_charges',
      'skipped', true,
      'reason', 'locked_or_paid'
    );
  end if;

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

  if v_existing.id is not null then
    update public.hh_payouts
    set gross_amount = v_gross,
        duty_count = v_count,
        hours = v_hours,
        net_amount = v_gross,
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD')
      || lpad((abs(hashtext(gen_random_uuid()::text)) % 100000)::text, 5, '0');
    insert into public.hh_payouts (
      id, employee_id, period_month, gross_amount, duty_count, hours,
      net_amount, advance, deduction, bonus, created_by, updated_by
    ) values (
      v_id, p_employee_id, p_period, v_gross, v_count, v_hours,
      v_gross, 0, 0, 0, public.hh_current_actor(), public.hh_current_actor()
    );
  end if;

  return jsonb_build_object(
    'payout_id', v_id,
    'gross', v_gross,
    'duties', v_count,
    'hours', v_hours,
    'period', p_period,
    'employee_id', p_employee_id,
    'source', 'hh_payout_charges',
    'adjustments_enabled', false
  );
end;
$$;

-- Patch cron rollup: skip LOCKED as well as PAID.
do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hominal_recompute_payouts_from_charge_attendance(date,date,text)'::regprocedure)
  into v_def;
  if v_def is not null then
    v_def := replace(
      v_def,
      'and upper(coalesce(p.status, '''')) <> ''PAID''',
      'and upper(coalesce(p.status, '''')) not in (''PAID'', ''LOCKED'')'
    );
    execute v_def;
  end if;
end;
$patch$;

commit;
