-- P1-18: hominal_save_receipt_v2 wraps the existing save in one transaction
-- AND recomputes the billing's paid_status before returning. Closes the race
-- where the client-side recomputePaidStatus() call could fire against a
-- billing that another receipt had already mutated between save and recompute.

set search_path = public, pg_temp;

create or replace function public.hominal_save_receipt_v2(p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_billing_id text := nullif(p_receipt->>'billing_id', '');
  v_billed numeric;
  v_received numeric;
  v_paid_status text;
  v_tolerance constant numeric := 0.005;
begin
  -- The inner RPC already does:
  --   * _hh_require_role(['Admin','Accountant','Manager','Staff'])
  --   * SELECT … FOR UPDATE on the billing row
  --   * receipt_no allocation if missing
  --   * conflict-safe upsert into hh_receipts
  --   * hh_duty_days_link_receipt for duty-day ledger linking
  --   * audit log write
  --
  -- v2's only added concern is the paid_status recompute, which previously
  -- lived in the Node service and could race when two receipts landed in
  -- the same window. Holding it inside the same Postgres transaction
  -- guarantees both observations see the post-insert state.
  v_row := public.hominal_save_receipt(p_receipt);

  if v_billing_id is null then
    return v_row;
  end if;

  select coalesce(sum(coalesce(nullif(total, 0), amt, 0)), 0)
    into v_billed
    from public.hh_svc_entries
   where billing_id = v_billing_id;

  select coalesce(sum(coalesce(amount, 0)), 0)
    into v_received
    from public.hh_receipts
   where billing_id = v_billing_id
     and deleted_at is null;

  if v_billed > 0 and v_received >= v_billed - v_tolerance then
    v_paid_status := 'PAID';
  elsif v_received > v_tolerance then
    v_paid_status := 'PARTIAL';
  else
    v_paid_status := 'UNPAID';
  end if;

  update public.hh_billings
     set paid_status = v_paid_status,
         updated_at = now()
   where id = v_billing_id;

  return v_row || jsonb_build_object('paid_status', v_paid_status);
end;
$$;

revoke all on function public.hominal_save_receipt_v2(jsonb) from public, anon;
grant execute on function public.hominal_save_receipt_v2(jsonb) to authenticated, service_role;
