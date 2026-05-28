-- P0-5: Cascading patient close.
--
-- Before this RPC, `patientService.remove()` flipped only the patient row
-- to `Closed`. Open billings stayed `Active`, scheduled future duties kept
-- their `SCHEDULED` status, and the duty-extend cron continued to add a
-- new day of charges every night for a patient nobody was treating any
-- more. That left ghost work-in-progress on payouts and invoices.
--
-- `hominal_close_patient` does the close in a single transaction:
--   1. Stamps `hh_patients.status = 'Closed'`.
--   2. Closes every Active billing on the patient (via the existing
--      `hominal_flip_billing_status` helper, which already enforces the
--      Active → Closed transition and writes its own audit trail).
--   3. Cancels SCHEDULED duties whose start_at is still in the future.
--   4. Truncates IN_PROGRESS duties so end_at <= now() — that stops the
--      duty-extend cron from materialising more days, without erasing
--      history the staff have already recorded.
--   5. Writes a single audit row summarising the cascade so the operator
--      can see at-a-glance what got touched.
--
-- The function is SECURITY DEFINER so PostgREST callers (Admin, Manager,
-- Staff) inherit write rights without needing a custom RLS policy, and is
-- guarded by `_hh_require_role` to keep the destructive surface tight.

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
  v_billing record;
  v_flip   jsonb;
begin
  perform public._hh_require_role(array['Admin','Manager','Staff']);

  if p_patient_id is null or btrim(p_patient_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'patient_id is required');
  end if;

  -- Serialise concurrent close attempts for the same patient. Reuses the
  -- same namespace key as hominal_flip_billing_status so the two RPCs
  -- can't deadlock each other from opposite ends.
  perform pg_advisory_xact_lock(hashtext('patient_billing:' || p_patient_id));

  select * into v_patient from public.hh_patients where id = p_patient_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Patient not found');
  end if;

  -- Step 1: patient row.
  update public.hh_patients
     set status     = 'Closed',
         updated_at = now(),
         updated_by = v_actor
   where id = p_patient_id;

  -- Step 2: cascade-close every Active billing. We loop instead of bulk
  -- update so each billing close goes through hominal_flip_billing_status
  -- and gets its own audit row + duplicate-active-billing checks.
  for v_billing in
    select id
      from public.hh_billings
     where patient_id = p_patient_id
       and initcap(coalesce(status, '')) = 'Active'
  loop
    v_flip := public.hominal_flip_billing_status(v_billing.id, 'Closed', v_actor, now());
    if coalesce((v_flip->>'ok')::boolean, false) then
      v_billings_closed := v_billings_closed + 1;
    end if;
  end loop;

  -- Step 3: cancel future SCHEDULED duties.
  update public.hh_duties
     set status     = 'CANCELLED',
         updated_at = now(),
         updated_by = v_actor
   where patient_id = p_patient_id
     and status     = 'SCHEDULED'
     and start_at  > now();
  get diagnostics v_duties_cancelled = row_count;

  -- Step 4: stop the cron from materialising more days for currently-running
  -- duties. We truncate end_at to now() rather than flipping status so the
  -- duty stays addressable for end-of-day attendance / billing reconciliation.
  update public.hh_duties
     set end_at     = least(end_at, now()),
         updated_at = now(),
         updated_by = v_actor
   where patient_id = p_patient_id
     and status in ('IN_PROGRESS', 'SCHEDULED')
     and end_at > now();
  get diagnostics v_duties_truncated = row_count;

  -- Step 5: cascade audit row.
  insert into public.hh_audit_logs(module, entity_id, action, actor, stamp, payload)
  values (
    'patient',
    p_patient_id,
    'close-cascade',
    v_actor,
    'Closed patient ' || p_patient_id ||
      ' (billings=' || v_billings_closed ||
      ', duties_cancelled=' || v_duties_cancelled ||
      ', duties_truncated=' || v_duties_truncated || ')' ||
      case when coalesce(p_reason, '') <> '' then ' — Reason: ' || p_reason else '' end,
    jsonb_build_object(
      'patient_id', p_patient_id,
      'reason', coalesce(p_reason, ''),
      'billings_closed', v_billings_closed,
      'duties_cancelled', v_duties_cancelled,
      'duties_truncated', v_duties_truncated
    )
  );

  return jsonb_build_object(
    'ok', true,
    'patient_id', p_patient_id,
    'billings_closed', v_billings_closed,
    'duties_cancelled', v_duties_cancelled,
    'duties_truncated', v_duties_truncated
  );
end;
$function$;

revoke all on function public.hominal_close_patient(text, text, text) from public;
grant execute on function public.hominal_close_patient(text, text, text) to authenticated, service_role;

commit;
