-- Close triggers FINAL invoice.
--
-- The user-facing rule:
--   "Once duty closed, final closing invoice is raised and deposit is
--    adjusted in it."
--
-- This migration wires that rule into the patient cascade RPC. Per-bill
-- closes (billingService.close → hominal_flip_billing_status) are handled
-- in the Node service layer so the existing audit / cap-duties /
-- compensating-rollback wiring stays intact. The patient cascade is a
-- single SQL transaction, so we hook the FINAL invoice generation here.
--
-- For each Active billing about to be closed by hominal_close_patient,
-- this updated RPC now:
--   1. Calls hominal_generate_final_invoice(billing_id, actor) BEFORE the
--      status flip — that RPC snapshots unbilled svc rows, appends a
--      Security Deposit Adjustment credit line, auto-creates a Refund
--      receipt if sec_dep > gross, and zeros hh_billings.sec_dep.
--   2. Treats the "nothing to finalize" error as a no-op (no svc rows
--      and no deposit means there is nothing to close-bill anyway).
--   3. Counts FINAL invoices raised in the summary payload for audit.

begin;

create or replace function public.hominal_close_patient(
  p_patient_id text,
  p_actor      text default '',
  p_reason     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_patient        public.hh_patients%rowtype;
  v_actor          text := coalesce(nullif(p_actor, ''), public.hh_current_actor(), 'system');
  v_billings_closed integer := 0;
  v_duties_cancelled integer := 0;
  v_duties_truncated integer := 0;
  v_finals_raised   integer := 0;
  v_refund_count    integer := 0;
  v_refund_total    numeric := 0;
  v_billing record;
  v_flip   jsonb;
  v_final  jsonb;
begin
  perform public._hh_require_role(array['Admin','Manager','Staff']);

  if p_patient_id is null or btrim(p_patient_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'patient_id is required');
  end if;

  perform pg_advisory_xact_lock(hashtext('patient_billing:' || p_patient_id));

  select * into v_patient from public.hh_patients where id = p_patient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Patient not found');
  end if;

  update public.hh_patients
     set status     = 'Closed',
         updated_at = now(),
         updated_by = v_actor
   where id = p_patient_id;

  -- Cascade-close every Active billing. For each one, raise the FINAL
  -- invoice (deposit applied) BEFORE flipping to Closed, so the deposit
  -- is reflected in the patient's invoice/receipt ledger at close time.
  -- FINAL invoice errors that are NOT "nothing to finalize" abort the
  -- transaction so the patient close is atomic with its books.
  for v_billing in
    select id
      from public.hh_billings
     where patient_id = p_patient_id
       and initcap(coalesce(status, '')) = 'Active'
  loop
    begin
      v_final := public.hominal_generate_final_invoice(v_billing.id, v_actor, 'patient close cascade');
      if v_final is not null then
        v_finals_raised := v_finals_raised + 1;
        if coalesce((v_final->>'refund_amount')::numeric, 0) > 0 then
          v_refund_count := v_refund_count + 1;
          v_refund_total := v_refund_total + (v_final->>'refund_amount')::numeric;
        end if;
      end if;
    exception
      when others then
        if SQLERRM ilike '%nothing to finalize%' then
          -- No unbilled svc + no deposit: nothing to do. Continue with the
          -- normal close path.
          null;
        else
          raise;
        end if;
    end;

    v_flip := public.hominal_flip_billing_status(v_billing.id, 'Closed', v_actor, now());
    if coalesce((v_flip->>'ok')::boolean, false) then
      v_billings_closed := v_billings_closed + 1;
    end if;
  end loop;

  update public.hh_duties
     set status     = 'CANCELLED',
         updated_at = now(),
         updated_by = v_actor
   where patient_id = p_patient_id
     and status     = 'SCHEDULED'
     and start_at  > now();
  get diagnostics v_duties_cancelled = row_count;

  update public.hh_duties
     set end_at     = least(end_at, now()),
         updated_at = now(),
         updated_by = v_actor
   where patient_id = p_patient_id
     and status in ('IN_PROGRESS', 'SCHEDULED')
     and end_at > now();
  get diagnostics v_duties_truncated = row_count;

  insert into public.hh_audit_logs(module, entity_id, action, actor, stamp, payload)
  values (
    'patient',
    p_patient_id,
    'close-cascade',
    v_actor,
    'Closed patient ' || p_patient_id ||
      ' (billings=' || v_billings_closed ||
      ', finals=' || v_finals_raised ||
      case when v_refund_count > 0 then ', refunds=' || v_refund_count || '@' || v_refund_total::text else '' end ||
      ', duties_cancelled=' || v_duties_cancelled ||
      ', duties_truncated=' || v_duties_truncated || ')' ||
      case when coalesce(p_reason, '') <> '' then ' -- Reason: ' || p_reason else '' end,
    jsonb_build_object(
      'patient_id', p_patient_id,
      'reason', coalesce(p_reason, ''),
      'billings_closed', v_billings_closed,
      'final_invoices_raised', v_finals_raised,
      'refund_count', v_refund_count,
      'refund_total', v_refund_total,
      'duties_cancelled', v_duties_cancelled,
      'duties_truncated', v_duties_truncated
    )
  );

  return jsonb_build_object(
    'ok', true,
    'patient_id', p_patient_id,
    'billings_closed', v_billings_closed,
    'final_invoices_raised', v_finals_raised,
    'refund_count', v_refund_count,
    'refund_total', v_refund_total,
    'duties_cancelled', v_duties_cancelled,
    'duties_truncated', v_duties_truncated
  );
end;
$function$;

revoke all on function public.hominal_close_patient(text, text, text) from public;
grant execute on function public.hominal_close_patient(text, text, text) to authenticated, service_role;

commit;
