-- P1 integrity: financial FK RESTRICT, status enums, RPC row locks.
--
-- PRE-CHECK (run manually before applying — migration aborts if any row returned):
--
--   -- Blockers: NULL or out-of-enum status values
--   select 'hh_billings' as tbl, id, status
--     from public.hh_billings
--    where status is null
--       or initcap(status) not in ('Active','Closed','Cancelled','Paused')
--   union all
--   select 'hh_payouts', id, status
--     from public.hh_payouts
--    where status is null
--       or upper(status) not in ('OPEN','LOCKED','APPROVED','PAID','CANCELLED');
--
--   -- Blockers: orphan child rows (would block RESTRICT if parent missing)
--   select 'hh_receipts orphan billing_id' as issue, r.id, r.billing_id
--     from public.hh_receipts r
--     left join public.hh_billings b on b.id = r.billing_id
--    where r.billing_id is not null and r.billing_id <> '' and b.id is null
--   union all
--   select 'hh_invoices orphan billing_id', i.id, i.billing_id
--     from public.hh_invoices i
--     left join public.hh_billings b on b.id = i.billing_id
--    where i.billing_id is not null and i.billing_id <> '' and b.id is null
--   union all
--   select 'hh_svc_entries orphan billing_id', s.id, s.billing_id
--     from public.hh_svc_entries s
--     left join public.hh_billings b on b.id = s.billing_id
--    where s.billing_id is not null and s.billing_id <> '' and b.id is null
--   union all
--   select 'hh_attendance orphan duty_id', a.id, a.duty_id
--     from public.hh_attendance a
--     left join public.hh_duties d on d.id = a.duty_id
--    where a.duty_id is not null and a.duty_id <> '' and d.id is null;

begin;

-- ── 1. Financial FKs: CASCADE → RESTRICT ─────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name,
      tc.constraint_name,
      ccu.table_name as ref_table,
      ccu.column_name as ref_column
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_name = rc.constraint_name
     and tc.constraint_schema = rc.constraint_schema
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = rc.constraint_name
     and kcu.constraint_schema = rc.constraint_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = rc.unique_constraint_name
     and ccu.constraint_schema = rc.unique_constraint_schema
    where rc.constraint_schema = 'public'
      and rc.delete_rule = 'CASCADE'
      and (
        (kcu.table_name in ('hh_receipts', 'hh_invoices', 'hh_svc_entries')
         and kcu.column_name = 'billing_id')
        or (kcu.table_name = 'hh_attendance' and kcu.column_name = 'duty_id')
      )
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      r.table_schema, r.table_name, r.constraint_name
    );
    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references %I.%I (%I) on delete restrict',
      r.table_schema,
      r.table_name,
      r.constraint_name,
      r.column_name,
      r.table_schema,
      r.ref_table,
      r.ref_column
    );
  end loop;
end $$;

-- ── 2. Status NOT NULL + CHECK ───────────────────────────────────────────────
update public.hh_billings
   set status = 'Active'
 where status is null;

update public.hh_payouts
   set status = 'OPEN'
 where status is null;

alter table public.hh_billings
  alter column status set not null;

alter table public.hh_payouts
  alter column status set not null;

alter table public.hh_billings
  drop constraint if exists chk_hh_billings_status;

alter table public.hh_billings
  add constraint chk_hh_billings_status
  check (initcap(status) in ('Active', 'Closed', 'Cancelled', 'Paused'));

alter table public.hh_payouts
  drop constraint if exists chk_hh_payouts_status;

alter table public.hh_payouts
  add constraint chk_hh_payouts_status
  check (upper(status) in ('OPEN', 'LOCKED', 'APPROVED', 'PAID', 'CANCELLED'));

-- ── 3. hh_recompute_payout — advisory lock + row lock (P1-11) ────────────────
-- Body preserved from 20260528103000_rpc_role_guards.sql; lock statements added.
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
    v_id := 'PO' || to_char(now(), 'YYMMDD') || lpad((floor(random() * 99999))::int::text, 5, '0');
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

-- ── 4. hh_convert_inquiry_to_patient — advisory lock + FOR UPDATE (P1-12) ──
create or replace function public.hh_convert_inquiry_to_patient(p_inquiry_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inq public.hh_inquiries%rowtype;
  v_pat public.hh_patients%rowtype;
  v_new_id text;
  v_disease text;
begin
  perform public._hh_require_role(array['Admin','Manager','Staff']);

  if p_inquiry_id is null or btrim(p_inquiry_id) = '' then
    raise exception 'inquiry_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('inquiry:' || p_inquiry_id));

  select * into v_inq
    from public.hh_inquiries
   where id = p_inquiry_id
   for update;

  if not found then raise exception 'inquiry % not found', p_inquiry_id; end if;

  if initcap(coalesce(v_inq.status, '')) = 'Converted' then
    return jsonb_build_object(
      'patient_id',
      (select p.id from public.hh_patients p
        where coalesce(p.phone,'') <> ''
          and lower(coalesce(p.phone,'')) = lower(coalesce(v_inq.phone,''))
        limit 1),
      'inquiry_id', p_inquiry_id,
      'already_converted', true
    );
  end if;

  v_disease := trim(both from concat_ws(
    ' — ',
    nullif(trim(coalesce(v_inq.service, '')), ''),
    nullif(trim(coalesce(v_inq.remarks, coalesce(v_inq.notes, ''))), '')
  ));

  select * into v_pat
  from public.hh_patients
  where coalesce(phone,'') <> '' and lower(coalesce(phone,'')) = lower(coalesce(v_inq.phone,''))
  for update
  limit 1;

  if found then
    v_new_id := v_pat.id;
    update public.hh_patients
    set
      age = case when coalesce(age, '') = '' then coalesce(v_inq.age, age) else age end,
      gender = case when coalesce(gender, '') = '' then coalesce(v_inq.gender, gender) else gender end,
      email = case when coalesce(email, '') = '' then coalesce(v_inq.email, email) else email end,
      disease_condition = case
        when coalesce(disease_condition, '') = '' and v_disease <> '' then v_disease
        else disease_condition
      end,
      updated_by = public.hh_current_actor(),
      updated_at = now()
    where id = v_new_id;
  else
    v_new_id := 'P' || to_char(now(), 'YYMMDD') ||
      lpad((abs(hashtext(gen_random_uuid()::text)) % 10000)::text, 4, '0');
    insert into public.hh_patients (
      id, name, phone, addr, area, city, age, gender, email, disease_condition,
      status, created, created_at, updated_at, created_by, updated_by
    ) values (
      v_new_id,
      coalesce(v_inq.name, ''),
      coalesce(v_inq.phone, ''),
      coalesce(v_inq.address, ''),
      coalesce(v_inq.area, ''),
      coalesce(v_inq.city, 'Ahmedabad'),
      coalesce(v_inq.age, ''),
      coalesce(v_inq.gender, ''),
      coalesce(v_inq.email, ''),
      coalesce(v_disease, ''),
      'Active',
      to_char(now(), 'DD Mon YYYY'),
      now(),
      now(),
      public.hh_current_actor(),
      public.hh_current_actor()
    );
  end if;

  update public.hh_inquiries
  set status = 'Converted',
      assigned_to = coalesce(assigned_to, ''),
      notes = coalesce(notes, ''),
      updated_by = public.hh_current_actor(),
      updated_at = now()
  where id = p_inquiry_id;

  return jsonb_build_object('patient_id', v_new_id, 'inquiry_id', p_inquiry_id);
end;
$function$;

commit;
