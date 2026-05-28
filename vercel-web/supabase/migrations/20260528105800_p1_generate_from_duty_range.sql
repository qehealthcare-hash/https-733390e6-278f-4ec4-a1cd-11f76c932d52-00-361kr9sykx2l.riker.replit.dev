-- P1-19: hominal_generate_from_duty_range inserts svc_entries + flips
-- duty.billing_id under one Postgres transaction. The Node service used to
-- run those two writes per-duty in a JS for-loop, so a thrown error halfway
-- through left the bill with half the svc rows and the other half of duties
-- still floating. Holding both writes inside a single transaction lets the
-- API hand the user "all-or-nothing" semantics without a custom rollback.

set search_path = public, pg_temp;

create or replace function public.hominal_generate_from_duty_range(
  p_billing_id text,
  p_duty_ids text[],
  p_svc_rows jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_row jsonb;
begin
  perform public._hh_require_role(array['Admin','Accountant','Manager','Staff']);

  if p_billing_id is null or p_billing_id = '' then
    raise exception 'billing_id is required' using errcode = '22023';
  end if;

  -- Serialise concurrent bill-generation for the same billing so two
  -- accountants firing the same month-end roll-up don't double-bill.
  perform pg_advisory_xact_lock(hashtext('billing:' || p_billing_id));

  select status into v_status
    from public.hh_billings
   where id = p_billing_id
   for update;
  if v_status is null then
    raise exception 'billing % not found', p_billing_id using errcode = 'P0002';
  end if;
  if v_status in ('Closed', 'Cancelled') then
    raise exception 'billing % is % — cannot add svc entries', p_billing_id, v_status
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_svc_rows, 'null'::jsonb)) = 'array' then
    for v_row in select jsonb_array_elements(p_svc_rows) loop
      insert into public.hh_svc_entries (
        id, billing_id, patient_id, employee_id, date, svc_key,
        service_name, qty, rate, amt, total, discount, remark,
        created_by, updated_at
      ) values (
        coalesce(nullif(v_row->>'id', ''), gen_random_uuid()::text),
        p_billing_id,
        nullif(v_row->>'patient_id', ''),
        nullif(v_row->>'employee_id', ''),
        nullif(v_row->>'date', '')::date,
        nullif(v_row->>'svc_key', ''),
        coalesce(v_row->>'service_name', ''),
        coalesce((v_row->>'qty')::numeric, 1),
        coalesce((v_row->>'rate')::numeric, 0),
        coalesce((v_row->>'amt')::numeric, 0),
        coalesce((v_row->>'total')::numeric, 0),
        coalesce((v_row->>'discount')::numeric, 0),
        coalesce(v_row->>'remark', ''),
        coalesce(p_actor, 'system'),
        now()
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  if p_duty_ids is not null and array_length(p_duty_ids, 1) > 0 then
    update public.hh_duties
       set billing_id = p_billing_id,
           updated_by = coalesce(p_actor, 'system'),
           updated_at = now()
     where id = any (p_duty_ids)
       and (billing_id is null or billing_id = '' or billing_id <> p_billing_id);
    get diagnostics v_updated = row_count;
  end if;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'billing',
    p_billing_id,
    'generate_from_duty_range',
    'Generated ' || v_inserted || ' svc rows from ' || coalesce(array_length(p_duty_ids, 1), 0) || ' duties',
    jsonb_build_object('inserted', v_inserted, 'duties_linked', v_updated)
  );

  return jsonb_build_object(
    'billing_id', p_billing_id,
    'inserted', v_inserted,
    'duties_linked', v_updated
  );
end;
$$;

revoke all on function public.hominal_generate_from_duty_range(text, text[], jsonb, text)
  from public, anon;
grant execute on function public.hominal_generate_from_duty_range(text, text[], jsonb, text)
  to authenticated, service_role;
