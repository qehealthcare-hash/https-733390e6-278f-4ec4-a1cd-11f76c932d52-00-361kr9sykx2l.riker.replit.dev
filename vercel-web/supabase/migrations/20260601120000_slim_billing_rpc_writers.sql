-- Phase 3: slim billing RPCs to lock + write + audit.
--
-- Domain policy (Cancelled receipts, outstanding caps, FINAL eligibility,
-- PAID invoice deletion) now lives in Node:
--   src/business/billingMutationRules.ts
--   src/services/billingService.ts
--
-- These RPCs keep transactional writes, RBAC (_hh_require_role), row locks,
-- receipt/invoice numbering, duty-day ledger links, and audit rows.

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- hominal_save_receipt — dumb writer
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
  v_patient_id text;
  v_billing_status text;
  v_actor text := coalesce(
    nullif(p_receipt->>'created_by', ''),
    public.hh_current_actor(),
    'system'
  );
  v_amount numeric;
  v_billing_found boolean := false;
  v_receipt_no text;
  v_from_date date;
  v_to_date date;
  v_paid_dates date[];
  v_linked integer;
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

-- ---------------------------------------------------------------------------
-- hominal_delete_invoice — dumb writer (PAID guard moved to Node)
-- ---------------------------------------------------------------------------
create or replace function public.hominal_delete_invoice(p_invoice_id text, p_actor text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inv public.hh_invoices%rowtype;
  v_detached integer := 0;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager']);
  if p_invoice_id is null or p_invoice_id = '' then
    raise exception 'invoice_id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));

  select * into v_inv from public.hh_invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Invoice not found');
  end if;

  update public.hh_receipts
     set invoice_id = null,
         updated_by = coalesce(nullif(p_actor, ''), updated_by)
   where invoice_id = p_invoice_id;
  get diagnostics v_detached = row_count;

  delete from public.hh_invoices where id = p_invoice_id;

  perform public.hh_compact_invoice_seq();

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'billing',
    p_invoice_id,
    'soft-delete',
    'Invoice ' || coalesce(v_inv.invoice_no, p_invoice_id) || ' deleted (' || v_detached || ' receipts detached)',
    jsonb_build_object(
      'invoice_no', v_inv.invoice_no,
      'billing_id', v_inv.billing_id,
      'receipts_detached', v_detached,
      'actor', coalesce(nullif(p_actor, ''), 'system')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'invoice_no', v_inv.invoice_no,
    'billing_id', v_inv.billing_id,
    'receipts_detached', v_detached
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- hominal_generate_final_invoice — policy gates removed; noop when empty
-- (orchestration body unchanged — still one atomic write transaction)
-- ---------------------------------------------------------------------------
create or replace function public.hominal_generate_final_invoice(
  p_billing_id text,
  p_actor text default null,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_billing public.hh_billings%rowtype;
  v_actor text := coalesce(nullif(p_actor, ''), public.hh_current_actor(), 'system');
  v_existing_id text;
  v_invoice_id text;
  v_invoice_no text;
  v_sec_dep numeric;
  v_gross numeric := 0;
  v_existing_invoiced numeric := 0;
  v_existing_receipts numeric := 0;
  v_outstanding_after_invoice numeric := 0;
  v_deposit_applied numeric := 0;
  v_refund_amount numeric := 0;
  v_security_receipt_id text;
  v_security_receipt_no text;
  v_refund_id text;
  v_refund_no text;
  v_from_date date;
  v_to_date date;
  v_line_count integer := 0;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager','Staff']);
  if p_billing_id is null or btrim(p_billing_id) = '' then
    raise exception 'billing_id is required' using errcode = '22023';
  end if;

  select * into v_billing from public.hh_billings where id = p_billing_id for update;
  if not found then
    raise exception 'billing % not found', p_billing_id using errcode = 'P0002';
  end if;
  if coalesce(nullif(trim(v_billing.patient_id), ''), null) is null then
    raise exception 'billing % has no linked patient', p_billing_id using errcode = '22023';
  end if;

  select id into v_existing_id from public.hh_invoices
   where billing_id = p_billing_id and kind = 'FINAL' and status <> 'CANCELLED' limit 1;
  if v_existing_id is not null then
    return jsonb_build_object(
      'invoice_id', v_existing_id,
      'duplicate', true,
      'noop', false,
      'security_receipt_id', null,
      'refund_id', null,
      'refund_amount', 0,
      'sec_dep_applied', 0,
      'gross', 0,
      'net', 0
    );
  end if;

  v_sec_dep := coalesce(v_billing.sec_dep, 0);

  create temp table _duty_windows (start_d date, end_d date) on commit drop;
  insert into _duty_windows
    select date(d.start_at), date(d.end_at)
    from public.hh_duties d
    where d.billing_id = p_billing_id
      and coalesce(d.status, 'SCHEDULED') not in ('CANCELLED', 'NO_SHOW');

  create temp table _final_lines (
    svc_entry_id bigint,
    date text,
    service_name text,
    partner text,
    count numeric,
    amt numeric,
    total numeric
  ) on commit drop;

  insert into _final_lines
    select null::bigint,
      coalesce(se.date,''),
      coalesce(se.service_name,''),
      coalesce(se.partner,''),
      coalesce(se.count,1),
      coalesce(se.amt,0),
      coalesce(nullif(se.total,0), coalesce(se.amt,0)*coalesce(se.count,1))
    from public.hh_svc_entries se
    where se.billing_id = p_billing_id
      and exists (
        select 1 from _duty_windows w
        where se.date::date between w.start_d and w.end_d
      )
      and not exists (
        select 1 from public.hh_invoice_lines il
        join public.hh_invoices i on i.id = il.invoice_id
        where i.billing_id = p_billing_id and i.status <> 'CANCELLED'
          and il.date = coalesce(se.date,'')
          and il.service_name = coalesce(se.service_name,'')
          and il.partner = coalesce(se.partner,'')
          and il.amt = coalesce(se.amt,0)
          and il.count = coalesce(se.count,1)
      )
    order by se.date;

  select coalesce(sum(total),0), min(date)::date, max(date)::date, count(*)
    into v_gross, v_from_date, v_to_date, v_line_count
    from _final_lines;

  if v_line_count = 0 and v_sec_dep = 0 then
    return jsonb_build_object(
      'invoice_id', null,
      'duplicate', false,
      'noop', true,
      'security_receipt_id', null,
      'refund_id', null,
      'refund_amount', 0,
      'sec_dep_applied', 0,
      'gross', 0,
      'net', 0,
      'line_count', 0
    );
  end if;

  select coalesce(sum(case when status <> 'CANCELLED' then amount else 0 end), 0)
    into v_existing_invoiced
    from public.hh_invoices where billing_id = p_billing_id;
  select coalesce(sum(amount), 0)
    into v_existing_receipts
    from public.hh_receipts where billing_id = p_billing_id and deleted_at is null;
  v_outstanding_after_invoice := greatest(0, (v_existing_invoiced + v_gross) - v_existing_receipts);

  v_deposit_applied := least(v_sec_dep, v_outstanding_after_invoice);
  v_refund_amount := greatest(0, v_sec_dep - v_deposit_applied);

  v_invoice_id := 'INV-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || p_billing_id) from 1 for 6);
  v_invoice_no := public.hh_next_invoice_no();
  insert into public.hh_invoices (
    id, invoice_no, billing_id, patient_id, kind, period, from_date, to_date,
    amount, status, notes, created_by, updated_by, created_at, updated_at
  )
  values (
    v_invoice_id, v_invoice_no, p_billing_id, v_billing.patient_id, 'FINAL', null,
    v_from_date, v_to_date, v_gross, 'UNPAID', coalesce(p_notes,''), v_actor, v_actor, now(), now()
  );

  if v_line_count > 0 then
    insert into public.hh_invoice_lines (invoice_id, svc_entry_id, date, service_name, partner, count, amt, total)
    select v_invoice_id, svc_entry_id, date, service_name, partner, count, amt, total from _final_lines;
  end if;

  if v_deposit_applied > 0 then
    v_security_receipt_id := 'RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || v_invoice_id || 'sec') from 1 for 6);
    v_security_receipt_no := public.hh_next_receipt_no();
    insert into public.hh_receipts (
      id, billing_id, patient_id, service_type, bill_mode, from_date, to_date,
      paid_days, paid_dates, date, type, amount, method, ref, remarks,
      receipt_no, invoice_id, deleted_at, created_by, updated_at
    )
    values (
      v_security_receipt_id, p_billing_id, v_billing.patient_id, '', '', null, null, 0, array[]::date[],
      to_char(now(), 'YYYY-MM-DD'), 'Security', v_deposit_applied, 'Deposit', '',
      'Security deposit applied to FINAL invoice ' || v_invoice_no,
      v_security_receipt_no, v_invoice_id, null, v_actor, now()
    );
  end if;

  if v_refund_amount > 0 then
    v_refund_id := 'RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || v_invoice_id || 'ref') from 1 for 6);
    v_refund_no := public.hh_next_receipt_no();
    insert into public.hh_receipts (
      id, billing_id, patient_id, service_type, bill_mode, from_date, to_date,
      paid_days, paid_dates, date, type, amount, method, ref, remarks,
      receipt_no, invoice_id, deleted_at, created_by, updated_at
    )
    values (
      v_refund_id, p_billing_id, v_billing.patient_id, '', '', null, null, 0, array[]::date[],
      to_char(now(), 'YYYY-MM-DD'), 'Refund', -v_refund_amount, 'Cash', '',
      'Security deposit refund -- FINAL invoice ' || v_invoice_no,
      v_refund_no, v_invoice_id, null, v_actor, now()
    );
  end if;

  update public.hh_billings set sec_dep = 0, updated_at = now() where id = p_billing_id;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'billing',
    v_invoice_id,
    'create',
    'FINAL invoice ' || v_invoice_no
      || ' gross ' || v_gross::text
      || ' lines ' || v_line_count::text
      || ' deposit_applied ' || v_deposit_applied::text
      || case when v_refund_amount > 0 then ' refund ' || v_refund_amount::text else '' end
      || case when v_billing.status = 'Closed' then ' (retroactive: bill already Closed)' else '' end,
    jsonb_build_object(
      'billing_id', p_billing_id,
      'invoice_id', v_invoice_id,
      'invoice_no', v_invoice_no,
      'gross', v_gross,
      'existing_invoiced', v_existing_invoiced,
      'existing_receipts', v_existing_receipts,
      'outstanding_after_invoice', v_outstanding_after_invoice,
      'sec_dep', v_sec_dep,
      'deposit_applied', v_deposit_applied,
      'security_receipt_id', v_security_receipt_id,
      'refund_id', v_refund_id,
      'refund_amount', v_refund_amount,
      'line_count', v_line_count,
      'billing_status_at_generation', v_billing.status
    )
  );

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_no', v_invoice_no,
    'duplicate', false,
    'noop', false,
    'security_receipt_id', v_security_receipt_id,
    'refund_id', v_refund_id,
    'refund_amount', v_refund_amount,
    'sec_dep_applied', v_deposit_applied,
    'gross', v_gross,
    'net', greatest(0, v_outstanding_after_invoice - v_deposit_applied),
    'line_count', v_line_count
  );
end;
$function$;

revoke all on function public.hominal_save_receipt(jsonb) from public, anon;
grant execute on function public.hominal_save_receipt(jsonb) to authenticated, service_role;

revoke all on function public.hominal_delete_invoice(text, text) from public, anon;
grant execute on function public.hominal_delete_invoice(text, text) to authenticated, service_role;

revoke all on function public.hominal_generate_final_invoice(text, text, text) from public;
grant execute on function public.hominal_generate_final_invoice(text, text, text) to authenticated, service_role;
