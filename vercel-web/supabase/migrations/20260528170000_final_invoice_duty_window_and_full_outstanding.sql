-- FINAL invoice v3
--
-- Two corrections on top of v2 (deposit-as-receipt):
--
-- 1. Phantom-day defence.
--    Only invoice svc_entries whose date falls inside at least one of the
--    billing's duty calendar windows (duty.start_at .. duty.end_at). The
--    close path used to extend a duty's end_at to "today" before calling
--    materialize, which silently inserted svc_entries past the real duty
--    end. Even after the close path is fixed, this filter prevents any
--    historical phantom rows from sneaking onto a FINAL invoice.
--
-- 2. Deposit applies against the WHOLE billing outstanding, not only the
--    new FINAL gross. v2 only used the deposit up to `gross`, which left
--    prior MONTHLY invoices unsettled even when the deposit was enough
--    to cover them. v3 computes the total outstanding once the FINAL is
--    on the books and applies the deposit against THAT.

set search_path = public, pg_temp;

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
  if not found then raise exception 'billing % not found', p_billing_id using errcode = 'P0002'; end if;
  if v_billing.status = 'Cancelled' then
    raise exception 'billing % is Cancelled -- final invoice not allowed', p_billing_id using errcode = 'P0001';
  end if;
  if coalesce(nullif(trim(v_billing.patient_id), ''), null) is null then
    raise exception 'billing % has no linked patient', p_billing_id using errcode = '22023';
  end if;

  select id into v_existing_id from public.hh_invoices
   where billing_id = p_billing_id and kind = 'FINAL' and status <> 'CANCELLED' limit 1;
  if v_existing_id is not null then
    return jsonb_build_object('invoice_id', v_existing_id, 'duplicate', true, 'security_receipt_id', null, 'refund_id', null, 'refund_amount', 0, 'sec_dep_applied', 0, 'gross', 0, 'net', 0);
  end if;

  v_sec_dep := coalesce(v_billing.sec_dep, 0);

  -- Build the candidate line set: unbilled svc_entries whose date falls
  -- inside at least one duty calendar window for this billing. This is
  -- the "only count duty calendar days which updated" guarantee.
  create temp table _duty_windows (start_d date, end_d date) on commit drop;
  insert into _duty_windows
    select date(d.start_at), date(d.end_at)
    from public.hh_duties d
    where d.billing_id = p_billing_id
      and coalesce(d.status, 'SCHEDULED') not in ('CANCELLED', 'NO_SHOW');

  create temp table _final_lines (svc_entry_id bigint, date text, service_name text, partner text, count numeric, amt numeric, total numeric) on commit drop;
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
      -- Phantom-day defence: must fall inside a real duty window.
      and exists (
        select 1 from _duty_windows w
        where se.date::date between w.start_d and w.end_d
      )
      -- Not already on a non-cancelled invoice (idempotency vs MONTHLY).
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
    raise exception 'no unbilled service entries and no security deposit -- nothing to finalize' using errcode = 'P0001';
  end if;

  -- Compute deposit application against TOTAL outstanding (existing
  -- invoices + this new FINAL - existing receipts). This lets the
  -- deposit settle prior unpaid MONTHLY balances too.
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
  insert into public.hh_invoices (id, invoice_no, billing_id, patient_id, kind, period, from_date, to_date, amount, status, notes, created_by, updated_by, created_at, updated_at)
  values (v_invoice_id, v_invoice_no, p_billing_id, v_billing.patient_id, 'FINAL', null, v_from_date, v_to_date, v_gross, 'UNPAID', coalesce(p_notes,''), v_actor, v_actor, now(), now());
  if v_line_count > 0 then
    insert into public.hh_invoice_lines (invoice_id, svc_entry_id, date, service_name, partner, count, amt, total)
      select v_invoice_id, svc_entry_id, date, service_name, partner, count, amt, total from _final_lines;
  end if;

  if v_deposit_applied > 0 then
    v_security_receipt_id := 'RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || v_invoice_id || 'sec') from 1 for 6);
    v_security_receipt_no := public.hh_next_receipt_no();
    insert into public.hh_receipts (id, billing_id, patient_id, service_type, bill_mode, from_date, to_date, paid_days, paid_dates, date, type, amount, method, ref, remarks, receipt_no, invoice_id, deleted_at, created_by, updated_at)
    values (v_security_receipt_id, p_billing_id, v_billing.patient_id, '', '', null, null, 0, array[]::date[], to_char(now(), 'YYYY-MM-DD'), 'Security', v_deposit_applied, 'Deposit', '', 'Security deposit applied to FINAL invoice ' || v_invoice_no, v_security_receipt_no, v_invoice_id, null, v_actor, now());
  end if;
  if v_refund_amount > 0 then
    v_refund_id := 'RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || v_invoice_id || 'ref') from 1 for 6);
    v_refund_no := public.hh_next_receipt_no();
    insert into public.hh_receipts (id, billing_id, patient_id, service_type, bill_mode, from_date, to_date, paid_days, paid_dates, date, type, amount, method, ref, remarks, receipt_no, invoice_id, deleted_at, created_by, updated_at)
    values (v_refund_id, p_billing_id, v_billing.patient_id, '', '', null, null, 0, array[]::date[], to_char(now(), 'YYYY-MM-DD'), 'Refund', -v_refund_amount, 'Cash', '', 'Security deposit refund -- FINAL invoice ' || v_invoice_no, v_refund_no, v_invoice_id, null, v_actor, now());
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

revoke all on function public.hominal_generate_final_invoice(text, text, text) from public;
grant execute on function public.hominal_generate_final_invoice(text, text, text) to authenticated;
