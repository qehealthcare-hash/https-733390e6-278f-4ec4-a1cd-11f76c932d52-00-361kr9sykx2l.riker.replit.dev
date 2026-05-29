-- hominal_save_receipt: allow receipts on Closed bills (recovery path).
--
-- Previously this RPC blocked any receipt against a billing whose status was
-- `Closed` OR `Cancelled`, so a bill that was force-closed (or auto-closed
-- after FINAL invoice generation) with an unpaid MONTHLY invoice on it
-- could not accept payment unless the supervisor first reopened the bill —
-- which also retriggered duty materialization for the open patient case.
--
-- New policy (matches the Node service layer in src/services/billingService
-- recordPayment and the billings page Add receipt form):
--   * Cancelled  → still rejected (terminal / voided bill).
--   * Closed     → ALLOWED. The existing outstanding-amount check below
--                  prevents overpayment, and the front-end guards against
--                  recording an advance on a fully-settled Closed bill.
--
-- The only line changed from migration 20260528120000_fix_receipt_patient_fk
-- is the status guard (`in ('Closed','Cancelled')` -> `= 'Cancelled'`). Every
-- other piece of behaviour (patient_id derivation, outstanding cap, audit
-- write, duty-day ledger link) is preserved verbatim.

set search_path = public, pg_temp;

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
  v_patient_id text;
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

  select b.status, b.patient_id, true
    into v_billing_status, v_patient_id, v_billing_found
    from public.hh_billings b
   where b.id = v_billing_id
   for update;

  if not v_billing_found then
    raise exception 'billing % not found', v_billing_id using errcode = 'P0002';
  end if;

  v_patient_id := coalesce(nullif(trim(p_receipt->>'patient_id'), ''), nullif(trim(v_patient_id), ''));
  if v_patient_id is null then
    raise exception 'patient_id is required — billing % has no linked patient', v_billing_id
      using errcode = '22023';
  end if;

  -- 2026-05-29: Closed is now a valid receipt target (settle outstanding
  -- without reopening). Cancelled remains hard-blocked.
  if v_billing_status = 'Cancelled' then
    raise exception 'billing % is Cancelled -- receipts not allowed', v_billing_id
      using errcode = 'P0001',
            hint = 'cancelled bills are terminal; create a new bill if needed';
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
    v_patient_id,
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
    patient_id = coalesce(nullif(excluded.patient_id, ''), v_patient_id),
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
    'Receipt ' || v_row.id || ' saved (' || v_linked || ' duty-days linked)'
      || case when v_billing_status = 'Closed' then ' [bill: Closed]' else '' end,
    to_jsonb(v_row)
  );

  return to_jsonb(v_row);
end;
$function$;
