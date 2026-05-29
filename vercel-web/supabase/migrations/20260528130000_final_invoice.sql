-- FINAL invoice flow.
--
-- A FINAL invoice closes a billing by:
--   1. Snapshotting every *unbilled* svc entry on the bill (positive lines).
--   2. Appending a "Security Deposit Adjustment" credit line equal to
--      -hh_billings.sec_dep (so the invoice nets to billed - deposit).
--   3. If sec_dep > gross billed, auto-creating a single Refund receipt
--      against the invoice for the excess (negative amount: money out).
--   4. Zeroing hh_billings.sec_dep so the deposit is never double-applied.
--
-- The whole flow runs in one transaction via the RPC below. Idempotent:
-- re-running for the same billing returns the existing non-CANCELLED
-- FINAL invoice with duplicate=true.

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1) Allow FINAL on hh_invoices.kind
-- ---------------------------------------------------------------------------

alter table public.hh_invoices
  drop constraint if exists chk_hh_invoices_kind;
alter table public.hh_invoices
  add constraint chk_hh_invoices_kind
  check (kind in ('MONTHLY', 'MANUAL', 'FINAL'));

-- One non-cancelled FINAL per billing (idempotency guard).
create unique index if not exists uq_hh_invoices_final_per_billing
  on public.hh_invoices (billing_id)
  where kind = 'FINAL' and status <> 'CANCELLED';

-- ---------------------------------------------------------------------------
-- 2) Allow negative amount on hh_receipts only when type='Refund'
--    (refunds are money OUT — encoded as negative receipt amounts).
-- ---------------------------------------------------------------------------

alter table public.hh_receipts
  drop constraint if exists hh_receipts_amount_nonnegative;
alter table public.hh_receipts
  add constraint hh_receipts_amount_sign
  check (
    coalesce(amount, 0) >= 0
    or coalesce(type, '') = 'Refund'
  );

-- ---------------------------------------------------------------------------
-- 3) hominal_generate_final_invoice
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
  v_net numeric;
  v_invoice_amount numeric;
  v_refund_amount numeric := 0;
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

  select * into v_billing
    from public.hh_billings
   where id = p_billing_id
   for update;

  if not found then
    raise exception 'billing % not found', p_billing_id using errcode = 'P0002';
  end if;
  if v_billing.status in ('Closed', 'Cancelled') then
    raise exception 'billing % is % -- final invoice not allowed', p_billing_id, v_billing.status
      using errcode = 'P0001';
  end if;
  if coalesce(nullif(trim(v_billing.patient_id), ''), null) is null then
    raise exception 'billing % has no linked patient', p_billing_id
      using errcode = '22023';
  end if;

  -- Idempotency: return existing non-cancelled FINAL if present.
  select id into v_existing_id
    from public.hh_invoices
   where billing_id = p_billing_id
     and kind = 'FINAL'
     and status <> 'CANCELLED'
   limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'invoice_id', v_existing_id,
      'duplicate', true,
      'refund_id', null,
      'refund_amount', 0,
      'sec_dep_applied', 0,
      'gross', 0,
      'net', 0
    );
  end if;

  v_sec_dep := coalesce(v_billing.sec_dep, 0);

  -- Snapshot unbilled svc entries (not on any non-cancelled invoice line).
  -- hh_invoice_lines.svc_entry_id is bigint; hh_svc_entries.id is uuid.
  -- We dedup via (date, service_name, partner, amt, count) on the same billing
  -- against existing FINAL/MANUAL/MONTHLY invoice lines for safety.
  create temp table _final_lines (
    svc_entry_id bigint,
    date text,
    service_name text,
    partner text,
    count numeric,
    amt numeric,
    total numeric
  ) on commit drop;

  insert into _final_lines (svc_entry_id, date, service_name, partner, count, amt, total)
  select
    null::bigint,
    coalesce(se.date, ''),
    coalesce(se.service_name, ''),
    coalesce(se.partner, ''),
    coalesce(se.count, 1),
    coalesce(se.amt, 0),
    coalesce(nullif(se.total, 0), coalesce(se.amt, 0) * coalesce(se.count, 1))
  from public.hh_svc_entries se
  where se.billing_id = p_billing_id
    and not exists (
      select 1
        from public.hh_invoice_lines il
        join public.hh_invoices i on i.id = il.invoice_id
       where i.billing_id = p_billing_id
         and i.status <> 'CANCELLED'
         and il.date = coalesce(se.date, '')
         and il.service_name = coalesce(se.service_name, '')
         and il.partner = coalesce(se.partner, '')
         and il.amt = coalesce(se.amt, 0)
         and il.count = coalesce(se.count, 1)
    )
  order by se.date;

  select coalesce(sum(total), 0), min(date)::date, max(date)::date, count(*)
    into v_gross, v_from_date, v_to_date, v_line_count
    from _final_lines;

  if v_line_count = 0 and v_sec_dep = 0 then
    raise exception 'no unbilled service entries and no security deposit — nothing to finalize'
      using errcode = 'P0001';
  end if;

  v_net := v_gross - v_sec_dep;
  v_invoice_amount := greatest(v_net, 0);
  v_refund_amount := case when v_net < 0 then abs(v_net) else 0 end;

  v_invoice_id := 'INV-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || p_billing_id) from 1 for 6);
  v_invoice_no := public.hh_next_invoice_no();

  insert into public.hh_invoices (
    id, invoice_no, billing_id, patient_id, kind, period,
    from_date, to_date, amount, status, notes,
    created_by, updated_by, created_at, updated_at
  ) values (
    v_invoice_id, v_invoice_no, p_billing_id, v_billing.patient_id,
    'FINAL', null,
    v_from_date, v_to_date, v_invoice_amount, 'UNPAID',
    coalesce(p_notes, ''),
    v_actor, v_actor, now(), now()
  );

  -- Positive lines first.
  if v_line_count > 0 then
    insert into public.hh_invoice_lines
      (invoice_id, svc_entry_id, date, service_name, partner, count, amt, total)
    select v_invoice_id, svc_entry_id, date, service_name, partner, count, amt, total
      from _final_lines;
  end if;

  -- Deposit credit line, if any.
  if v_sec_dep > 0 then
    insert into public.hh_invoice_lines
      (invoice_id, svc_entry_id, date, service_name, partner, count, amt, total)
    values (
      v_invoice_id, null, to_char(now(), 'YYYY-MM-DD'),
      'Security Deposit Adjustment', '',
      1, -v_sec_dep, -v_sec_dep
    );
  end if;

  -- Auto-refund if deposit > gross billed.
  if v_refund_amount > 0 then
    v_refund_id := 'RCP-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text || v_invoice_id) from 1 for 6);
    v_refund_no := public.hh_next_receipt_no();

    insert into public.hh_receipts (
      id, billing_id, patient_id, service_type, bill_mode,
      from_date, to_date, paid_days, paid_dates,
      date, type, amount, method, ref, remarks,
      receipt_no, invoice_id, deleted_at, created_by, updated_at
    ) values (
      v_refund_id, p_billing_id, v_billing.patient_id, '', '',
      null, null, 0, array[]::date[],
      to_char(now(), 'YYYY-MM-DD'),
      'Refund', -v_refund_amount, 'Cash', '',
      'Security deposit refund — FINAL invoice ' || v_invoice_no,
      v_refund_no, v_invoice_id, null,
      v_actor, now()
    );
  end if;

  -- Zero out the deposit on the billing (it is now accounted for in the invoice).
  update public.hh_billings
     set sec_dep = 0,
         updated_at = now()
   where id = p_billing_id;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'billing',
    v_invoice_id,
    'create',
    'FINAL invoice ' || v_invoice_no ||
      ' gross ' || v_gross::text ||
      ' deposit ' || v_sec_dep::text ||
      ' net ' || v_invoice_amount::text ||
      case when v_refund_amount > 0 then ' refund ' || v_refund_amount::text else '' end,
    jsonb_build_object(
      'billing_id', p_billing_id,
      'invoice_id', v_invoice_id,
      'invoice_no', v_invoice_no,
      'gross', v_gross,
      'sec_dep', v_sec_dep,
      'net', v_net,
      'refund_id', v_refund_id,
      'refund_amount', v_refund_amount,
      'line_count', v_line_count
    )
  );

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_no', v_invoice_no,
    'duplicate', false,
    'refund_id', v_refund_id,
    'refund_amount', v_refund_amount,
    'sec_dep_applied', v_sec_dep,
    'gross', v_gross,
    'net', v_invoice_amount,
    'line_count', v_line_count
  );
end;
$function$;

revoke all on function public.hominal_generate_final_invoice(text, text, text) from public;
grant execute on function public.hominal_generate_final_invoice(text, text, text) to authenticated;
