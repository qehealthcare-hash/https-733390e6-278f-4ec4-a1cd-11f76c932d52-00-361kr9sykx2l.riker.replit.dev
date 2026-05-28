-- P0-2: Add role guards to every SECURITY DEFINER write RPC.
--
-- These functions are all exposed to `authenticated` via PostgREST
-- (`POST /rest/v1/rpc/<name>`). Before this migration any active CRM user
-- (Caretaker, Nurse, Viewer …) could call them directly and bypass the
-- application's UI role gates. This migration installs an internal
-- `hh_has_role(...)` check at the top of each function so the role
-- requirement is enforced by Postgres itself, regardless of caller path.
--
-- The function bodies are preserved byte-for-byte from production
-- (`pg_get_functiondef`); only a single `perform public._hh_require_role(...)`
-- statement has been prepended.

begin;

-- Helper that raises 42501 (insufficient_privilege) when the caller's
-- application role is not in the allow list. Uses the existing
-- `hh_has_role(text[])` SECURITY DEFINER helper.
create or replace function public._hh_require_role(p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not hh_has_role(p_roles) then
    raise exception 'forbidden: caller lacks one of % roles', p_roles
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._hh_require_role(text[]) from public;
grant execute on function public._hh_require_role(text[]) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- hominal_delete_invoice  →  Admin / Accountant / Manager
-- ---------------------------------------------------------------------------
create or replace function public.hominal_delete_invoice(p_invoice_id text, p_actor text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_inv public.hh_invoices%rowtype; v_detached integer := 0; v_status text;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  if p_invoice_id is null or p_invoice_id = '' then raise exception 'invoice_id is required'; end if;
  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));
  select * into v_inv from public.hh_invoices where id = p_invoice_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Invoice not found'); end if;
  v_status := upper(coalesce(v_inv.status, ''));
  if v_status = 'PAID' then return jsonb_build_object('ok', false, 'code', 'BUSINESS', 'message', 'Cannot delete a PAID invoice — void receipts first'); end if;
  update public.hh_receipts set invoice_id = null, updated_by = coalesce(nullif(p_actor, ''), updated_by) where invoice_id = p_invoice_id;
  get diagnostics v_detached = row_count;
  delete from public.hh_invoices where id = p_invoice_id;
  perform public.hh_compact_invoice_seq();
  return jsonb_build_object('ok', true, 'invoice_no', v_inv.invoice_no, 'billing_id', v_inv.billing_id, 'receipts_detached', v_detached);
end; $function$;


-- ---------------------------------------------------------------------------
-- hominal_flip_billing_status  →  Admin / Accountant / Manager
-- ---------------------------------------------------------------------------
create or replace function public.hominal_flip_billing_status(
  p_billing_id text,
  p_target_status text,
  p_actor text,
  p_closed_at timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.hh_billings%rowtype;
  v_target text;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  if coalesce(trim(p_billing_id), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'billing_id required');
  end if;

  v_target := initcap(lower(trim(coalesce(p_target_status, ''))));
  if v_target not in ('Active', 'Closed') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'target_status must be Active or Closed');
  end if;

  select * into v_row from public.hh_billings where id = p_billing_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Billing not found');
  end if;

  perform pg_advisory_xact_lock(hashtext('patient_billing:' || coalesce(v_row.patient_id, '')));

  if v_target = 'Closed' then
    if initcap(v_row.status) <> 'Active' then
      return jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Bill is not Active — refresh and retry', 'status', v_row.status);
    end if;
    update public.hh_billings
       set status = 'Closed',
           closed_at = coalesce(p_closed_at, now()),
           updated_at = now(),
           updated_by = coalesce(p_actor, updated_by)
     where id = p_billing_id;
  else
    if initcap(v_row.status) <> 'Closed' then
      return jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Bill is not Closed — refresh and retry', 'status', v_row.status);
    end if;
    if exists (
      select 1
        from public.hh_billings b
       where b.patient_id = v_row.patient_id
         and initcap(b.status) = 'Active'
         and b.id <> p_billing_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'duplicate', 'message', 'Patient already has another Active bill');
    end if;
    update public.hh_billings
       set status = 'Active',
           closed_at = null,
           updated_at = now(),
           updated_by = coalesce(p_actor, updated_by)
     where id = p_billing_id;
  end if;

  select * into v_row from public.hh_billings where id = p_billing_id;
  return jsonb_build_object('ok', true, 'billing', to_jsonb(v_row));
end;
$function$;


-- ---------------------------------------------------------------------------
-- hominal_soft_delete_receipt  →  Admin / Accountant / Manager
-- ---------------------------------------------------------------------------
create or replace function public.hominal_soft_delete_receipt(
  p_receipt_id text,
  p_billing_id text,
  p_deleted_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.hh_receipts%rowtype;
  v_actor text := coalesce(nullif(p_deleted_by, ''), auth.email(), 'system');
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  if p_receipt_id is null or btrim(p_receipt_id) = '' then raise exception 'p_receipt_id is required'; end if;
  if p_billing_id is null or btrim(p_billing_id) = '' then raise exception 'p_billing_id is required'; end if;

  update public.hh_receipts
  set deleted_at = coalesce(deleted_at, now()),
      deleted_by = v_actor,
      updated_at = now()
  where id = p_receipt_id and billing_id = p_billing_id
  returning * into v_row;

  if not found then
    raise exception 'receipt % not found for billing %', p_receipt_id, p_billing_id;
  end if;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values ('receipt', v_row.id, 'soft-delete', 'Receipt ' || v_row.id || ' deleted', to_jsonb(v_row));

  return to_jsonb(v_row);
end;
$function$;


-- ---------------------------------------------------------------------------
-- hominal_save_receipt  →  Admin / Accountant / Manager / Staff
-- Receipts are recorded by reception during normal operation.
-- ---------------------------------------------------------------------------
create or replace function public.hominal_save_receipt(p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.hh_receipts%rowtype;
  v_id text := nullif(p_receipt->>'id', '');
  v_billing_id text := nullif(p_receipt->>'billing_id', '');
  v_actor text := coalesce(
    nullif(p_receipt->>'created_by', ''),
    public.hh_current_actor(),
    'system'
  );
  v_amount numeric;
  v_billed numeric;
  v_other_receipts numeric;
  v_billing_status text;
  v_billing_found boolean := false;
  v_receipt_no text;
  v_from_date date;
  v_to_date date;
  v_paid_dates date[];
  v_linked integer;
  v_tolerance constant numeric := 0.005;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager','Staff']);
  if v_id is null then
    raise exception 'receipt id is required' using errcode = '22023';
  end if;
  if v_billing_id is null then
    raise exception 'billing_id is required' using errcode = '22023';
  end if;

  v_amount := coalesce(nullif(p_receipt->>'amount', ''), '0')::numeric;
  if v_amount < 0 then
    raise exception 'receipt amount must be non-negative' using errcode = '22023';
  end if;

  v_from_date := nullif(p_receipt->>'from_date', '')::date;
  v_to_date := nullif(p_receipt->>'to_date', '')::date;

  if jsonb_typeof(coalesce(p_receipt->'paid_dates', 'null'::jsonb)) = 'array' then
    select coalesce(array_agg(elem::date), array[]::date[])
      into v_paid_dates
      from jsonb_array_elements_text(p_receipt->'paid_dates') as t(elem)
     where elem ~ '^\d{4}-\d{2}-\d{2}$';
  else
    v_paid_dates := array[]::date[];
  end if;

  select b.status, true
    into v_billing_status, v_billing_found
    from public.hh_billings b
   where b.id = v_billing_id
   for update;

  if not v_billing_found then
    raise exception 'billing % not found', v_billing_id using errcode = 'P0002';
  end if;

  if v_billing_status in ('Closed', 'Cancelled') then
    raise exception 'billing % is % -- receipts not allowed', v_billing_id, v_billing_status
      using errcode = 'P0001',
            hint = 'reopen the billing before recording new payments';
  end if;

  select coalesce(sum(coalesce(nullif(total, 0), amt, 0)), 0)::numeric
    into v_billed
    from public.hh_svc_entries
   where billing_id = v_billing_id;

  select coalesce(sum(coalesce(amount, 0)), 0)::numeric
    into v_other_receipts
    from public.hh_receipts
   where billing_id = v_billing_id
     and deleted_at is null
     and id <> v_id;

  if (v_other_receipts + v_amount) > (v_billed + v_tolerance) then
    raise exception
      'receipt amount % exceeds bill outstanding (billed %, already received %)',
      v_amount, v_billed, v_other_receipts
      using errcode = 'P0001',
            hint = 'reload the billing -- another payment may have completed';
  end if;

  v_receipt_no := nullif(p_receipt->>'receipt_no', '');
  if v_receipt_no is null then
    v_receipt_no := public.hh_next_receipt_no();
  end if;

  insert into public.hh_receipts (
    id, billing_id, patient_id, service_type, bill_mode,
    from_date, to_date, paid_days, paid_dates,
    date, type, amount, method, ref, remarks,
    receipt_no, invoice_id, deleted_at, created_by, updated_at
  )
  values (
    v_id, v_billing_id,
    coalesce(p_receipt->>'patient_id', ''),
    coalesce(p_receipt->>'service_type', ''),
    coalesce(p_receipt->>'bill_mode', ''),
    v_from_date,
    v_to_date,
    coalesce(nullif(p_receipt->>'paid_days', ''), '0')::integer,
    v_paid_dates,
    coalesce(p_receipt->>'date', ''),
    coalesce(p_receipt->>'type', ''),
    v_amount,
    coalesce(p_receipt->>'method', ''),
    coalesce(p_receipt->>'ref', ''),
    coalesce(p_receipt->>'remarks', ''),
    v_receipt_no,
    nullif(p_receipt->>'invoice_id', ''),
    nullif(p_receipt->>'deleted_at', '')::timestamptz,
    v_actor, now()
  )
  on conflict (id) do update set
    billing_id = excluded.billing_id,
    patient_id = excluded.patient_id,
    service_type = excluded.service_type,
    bill_mode = excluded.bill_mode,
    from_date = excluded.from_date,
    to_date = excluded.to_date,
    paid_days = excluded.paid_days,
    paid_dates = excluded.paid_dates,
    date = excluded.date,
    type = excluded.type,
    amount = excluded.amount,
    method = excluded.method,
    ref = excluded.ref,
    remarks = excluded.remarks,
    receipt_no = coalesce(public.hh_receipts.receipt_no, excluded.receipt_no),
    invoice_id = excluded.invoice_id,
    deleted_at = excluded.deleted_at,
    created_by = coalesce(public.hh_receipts.created_by, excluded.created_by),
    updated_at = now()
  returning * into v_row;

  v_linked := public.hh_duty_days_link_receipt(
    v_row.id,
    v_row.billing_id,
    case when v_row.from_date is not null then to_char(v_row.from_date, 'YYYY-MM-DD') else null end,
    case when v_row.to_date is not null then to_char(v_row.to_date, 'YYYY-MM-DD') else null end,
    coalesce(p_receipt->'paid_dates', '[]'::jsonb)
  );

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'receipt',
    v_row.id,
    'save',
    'Receipt ' || v_row.id || ' saved (' || v_linked || ' duty-days linked)',
    to_jsonb(v_row)
  );

  return to_jsonb(v_row);
end;
$function$;


-- ---------------------------------------------------------------------------
-- hh_recompute_payout  →  Admin / Accountant / Manager / Staff / Nurse
--
-- Wider than the destructive RPCs because attendance side-effects in
-- attendanceService trigger this recompute. Staff and Nurse must be able
-- to mark attendance without the recompute failing them. The function is
-- a deterministic recalculation from existing rows, so widening the
-- caller set does NOT grant any new write capability.
-- ---------------------------------------------------------------------------
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
  where employee_id = p_employee_id and period_month = p_period;

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


-- ---------------------------------------------------------------------------
-- hh_compact_invoice_seq  →  Admin / Accountant / Manager
-- (Also called transitively from hominal_delete_invoice; that path already
-- passed the guard for the same role list, so the internal call succeeds.)
-- ---------------------------------------------------------------------------
create or replace function public.hh_compact_invoice_seq()
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare v_max bigint := 0;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));
  select coalesce(max(nullif(regexp_replace(invoice_no, '^INV[0-9]{4}', ''), '')::bigint), 0)
    into v_max
    from public.hh_invoices
   where invoice_no ~ '^INV[0-9]{4}[0-9]+$';
  if v_max <= 0 then perform setval('public.hh_invoice_seq', 1, false);
  else perform setval('public.hh_invoice_seq', v_max, true); end if;
  return v_max;
end;
$function$;


-- ---------------------------------------------------------------------------
-- hh_convert_inquiry_to_patient  →  Admin / Manager / Staff
-- ---------------------------------------------------------------------------
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
  select * into v_inq from public.hh_inquiries where id = p_inquiry_id;
  if not found then raise exception 'inquiry % not found', p_inquiry_id; end if;

  v_disease := trim(both from concat_ws(
    ' — ',
    nullif(trim(coalesce(v_inq.service, '')), ''),
    nullif(trim(coalesce(v_inq.remarks, coalesce(v_inq.notes, ''))), '')
  ));

  select * into v_pat
  from public.hh_patients
  where coalesce(phone,'') <> '' and lower(coalesce(phone,'')) = lower(coalesce(v_inq.phone,''))
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
    v_new_id := 'P' || to_char(now(), 'YYMMDD') || lpad((floor(random()*9999))::int::text, 4, '0');
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
