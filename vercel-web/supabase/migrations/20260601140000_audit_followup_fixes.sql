-- Audit follow-up: idempotency timestamps, payout id entropy, duty_days FK (P0-8, P0-9, P1-45).

begin;

-- P0-9: hh_idempotency.updated_at (internal rule #8)
alter table public.hh_idempotency
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.hh_idempotency_touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_hh_idempotency_updated_at on public.hh_idempotency;
create trigger trg_hh_idempotency_updated_at
  before update on public.hh_idempotency
  for each row execute function public.hh_idempotency_touch_updated_at();

-- P0-8: hh_recompute_payout — no random() for new payout ids
create or replace function public.hh_recompute_payout(p_employee_id text, p_period text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id text;
  v_hours numeric := 0;
  v_count integer := 0;
  v_gross numeric := 0;
  v_existing public.hh_payouts%rowtype;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager','Staff','Nurse']);
  if p_employee_id is null or p_period is null then
    raise exception 'employee_id and period are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('payout:' || p_employee_id || ':' || p_period));

  select count(*), coalesce(sum(hours), 0)
  into v_count, v_hours
  from public.hh_attendance a
  where a.employee_id = p_employee_id
    and to_char(
      coalesce(
        a.work_date,
        (coalesce(a.check_in_at, a.updated_at, a.created_at, now()) at time zone 'Asia/Kolkata')::date
      ),
      'YYYY-MM'
    ) = p_period
    and a.status in ('PRESENT', 'LATE', 'HALF_DAY');

  select coalesce(sum(amount), 0)
  into v_gross
  from public.hh_payout_charges
  where (
    partner_id = p_employee_id
    or partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and (
    substr(coalesce(date, ''), 1, 7) = p_period
    or to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
  );

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period
  for update;

  if found then
    update public.hh_payouts
    set gross_amount = v_gross,
        duty_count = v_count,
        hours = v_hours,
        net_amount = v_gross + coalesce(bonus, 0) - coalesce(advance, 0) - coalesce(deduction, 0),
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD')
      || lpad((abs(hashtext(gen_random_uuid()::text)) % 100000)::text, 5, '0');
    insert into public.hh_payouts (
      id, employee_id, period_month, gross_amount, duty_count, hours, net_amount, created_by, updated_by
    ) values (
      v_id, p_employee_id, p_period, v_gross, v_count, v_hours, v_gross,
      public.hh_current_actor(), public.hh_current_actor()
    );
  end if;

  return jsonb_build_object(
    'payout_id', v_id,
    'gross', v_gross,
    'duties', v_count,
    'hours', v_hours,
    'period', p_period,
    'employee_id', p_employee_id
  );
end;
$function$;

-- P1-45: preserve ledger rows when svc_entries are removed (RESTRICT, not CASCADE)
alter table public.hh_duty_days
  drop constraint if exists hh_duty_days_svc_entry_id_fkey;

alter table public.hh_duty_days
  add constraint hh_duty_days_svc_entry_id_fkey
  foreign key (svc_entry_id) references public.hh_svc_entries(id) on delete restrict;

commit;
