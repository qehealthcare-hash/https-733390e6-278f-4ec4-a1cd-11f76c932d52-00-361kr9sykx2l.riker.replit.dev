-- =============================================================================
-- Migration 049 — Phase 16 (ledger RPC cut-over, report views, date indexes)
--
-- 1. Receipt save/delete RPCs atomically update hh_duty_days (Phase 11b)
-- 2. SQL views for billing/payout period reporting
-- 3. Date-range indexes on legacy text date columns
-- =============================================================================

begin;

-- ── 1. Ledger helpers ───────────────────────────────────────────────────────

create or replace function public.hh_duty_days_link_receipt(
  p_receipt_id text,
  p_billing_id text,
  p_from text,
  p_to text,
  p_paid_dates jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_from date;
  v_to date;
begin
  if coalesce(p_receipt_id, '') = '' or coalesce(p_billing_id, '') = '' then
    return 0;
  end if;

  if jsonb_typeof(coalesce(p_paid_dates, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_paid_dates) > 0 then
    update public.hh_duty_days d
    set
      paid_receipt_id = p_receipt_id,
      paid_to_patient_at = coalesce(d.paid_to_patient_at, now()),
      updated_by = coalesce(d.updated_by, 'rpc:receipt'),
      updated_at = now()
    where d.billing_id = p_billing_id
      and d.deleted_at is null
      and (d.paid_receipt_id is null or d.paid_receipt_id = p_receipt_id)
      and d.service_date in (
        select pd.dt::date
        from jsonb_array_elements_text(p_paid_dates) as pd(dt)
        where pd.dt ~ '^\d{4}-\d{2}-\d{2}$'
      );
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  if coalesce(p_from, '') ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(p_to, '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_from := p_from::date;
    v_to := p_to::date;
    if v_to < v_from then
      v_to := v_from;
    end if;
    update public.hh_duty_days d
    set
      paid_receipt_id = p_receipt_id,
      paid_to_patient_at = coalesce(d.paid_to_patient_at, now()),
      updated_by = coalesce(d.updated_by, 'rpc:receipt'),
      updated_at = now()
    where d.billing_id = p_billing_id
      and d.deleted_at is null
      and (d.paid_receipt_id is null or d.paid_receipt_id = p_receipt_id)
      and d.service_date between v_from and v_to;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  if coalesce(p_from, '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_from := p_from::date;
    update public.hh_duty_days d
    set
      paid_receipt_id = p_receipt_id,
      paid_to_patient_at = coalesce(d.paid_to_patient_at, now()),
      updated_by = coalesce(d.updated_by, 'rpc:receipt'),
      updated_at = now()
    where d.billing_id = p_billing_id
      and d.deleted_at is null
      and (d.paid_receipt_id is null or d.paid_receipt_id = p_receipt_id)
      and d.service_date = v_from;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

create or replace function public.hh_duty_days_unlink_receipt(p_receipt_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if coalesce(p_receipt_id, '') = '' then return 0; end if;
  update public.hh_duty_days
  set
    paid_receipt_id = null,
    paid_to_patient_at = null,
    updated_by = coalesce(updated_by, 'rpc:receipt-delete'),
    updated_at = now()
  where paid_receipt_id = p_receipt_id
    and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.hh_duty_days_link_receipt(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hh_duty_days_unlink_receipt(text) from public, anon, authenticated;

-- ── 2. Receipt RPCs — atomic ledger (replace Phase 11 parallel sync) ───────

create or replace function public.hominal_save_receipt(p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hh_receipts%rowtype;
  v_id text := nullif(p_receipt->>'id', '');
  v_billing_id text := nullif(p_receipt->>'billing_id', '');
  v_actor text := coalesce(nullif(p_receipt->>'created_by', ''), public.hh_current_actor(), 'system');
  v_linked integer;
begin
  if v_id is null then raise exception 'receipt id is required'; end if;
  if v_billing_id is null then raise exception 'billing_id is required'; end if;

  insert into public.hh_receipts (
    id, billing_id, patient_id, service_type, bill_mode,
    from_date, to_date, paid_days, paid_dates,
    date, type, amount, method, ref, remarks,
    deleted_at, created_by, updated_at
  )
  values (
    v_id, v_billing_id,
    coalesce(p_receipt->>'patient_id', ''),
    coalesce(p_receipt->>'service_type', ''),
    coalesce(p_receipt->>'bill_mode', ''),
    coalesce(p_receipt->>'from_date', ''),
    coalesce(p_receipt->>'to_date', ''),
    coalesce(nullif(p_receipt->>'paid_days', ''), '0')::numeric,
    coalesce(p_receipt->'paid_dates', '[]'::jsonb),
    coalesce(p_receipt->>'date', ''),
    coalesce(p_receipt->>'type', ''),
    coalesce(nullif(p_receipt->>'amount', ''), '0')::numeric,
    coalesce(p_receipt->>'method', ''),
    coalesce(p_receipt->>'ref', ''),
    coalesce(p_receipt->>'remarks', ''),
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
    deleted_at = excluded.deleted_at,
    created_by = coalesce(public.hh_receipts.created_by, excluded.created_by),
    updated_at = now()
  returning * into v_row;

  v_linked := public.hh_duty_days_link_receipt(
    v_row.id,
    v_row.billing_id,
    v_row.from_date,
    v_row.to_date,
    coalesce(v_row.paid_dates, '[]'::jsonb)
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
$$;

create or replace function public.hominal_soft_delete_receipt(
  p_receipt_id text,
  p_billing_id text,
  p_deleted_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hh_receipts%rowtype;
  v_actor text := coalesce(nullif(p_deleted_by, ''), public.hh_current_actor(), 'system');
  v_unlinked integer;
begin
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

  v_unlinked := public.hh_duty_days_unlink_receipt(p_receipt_id);

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values (
    'receipt',
    v_row.id,
    'soft-delete',
    'Receipt ' || v_row.id || ' deleted (' || v_unlinked || ' duty-days released)',
    to_jsonb(v_row)
  );

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.hominal_save_receipt(jsonb) to authenticated;
grant execute on function public.hominal_soft_delete_receipt(text, text, text) to authenticated;

-- ── 3. Report views (security invoker — RLS on base tables applies) ─────────

create or replace view public.hh_v_billing_receipt_totals
with (security_invoker = true)
as
select
  b.id as billing_id,
  b.patient_id,
  b.status,
  coalesce(svc.billed_amount, 0)::numeric(14, 2) as billed_amount,
  coalesce(rec.received_amount, 0)::numeric(14, 2) as received_amount,
  greatest(
    coalesce(svc.billed_amount, 0)::numeric(14, 2)
      - coalesce(rec.received_amount, 0)::numeric(14, 2),
    0
  )::numeric(14, 2) as outstanding_amount
from public.hh_billings b
left join (
  select
    billing_id,
    sum(coalesce(nullif(total, 0), amt, 0))::numeric(14, 2) as billed_amount
  from public.hh_svc_entries
  group by billing_id
) svc on svc.billing_id = b.id
left join (
  select
    billing_id,
    sum(coalesce(amount, 0))::numeric(14, 2) as received_amount
  from public.hh_receipts
  where deleted_at is null
  group by billing_id
) rec on rec.billing_id = b.id;

create or replace view public.hh_v_duty_days_open
with (security_invoker = true)
as
select
  d.id,
  d.billing_id,
  d.patient_id,
  d.employee_id,
  d.service_date,
  d.service_name,
  d.patient_rate,
  d.staff_rate,
  d.paid_receipt_id,
  d.paid_charge_id
from public.hh_duty_days d
where d.deleted_at is null;

grant select on public.hh_v_billing_receipt_totals to authenticated;
grant select on public.hh_v_duty_days_open to authenticated;

-- ── 4. Date / period indexes ────────────────────────────────────────────────

create index if not exists idx_hh_svc_entries_billing_date_text
  on public.hh_svc_entries (billing_id, date)
  where date ~ '^\d{4}-\d{2}-\d{2}$';

create index if not exists idx_hh_receipts_billing_date_active
  on public.hh_receipts (billing_id, date)
  where deleted_at is null;

create index if not exists idx_hh_payout_charges_svc_date
  on public.hh_payout_charges (svc_key, date);

create index if not exists idx_hh_duty_days_service_date
  on public.hh_duty_days (service_date)
  where deleted_at is null;

comment on view public.hh_v_billing_receipt_totals is
  'Phase 16 — per-billing billed vs received for reports/dashboard parity.';
comment on view public.hh_v_duty_days_open is
  'Phase 16 — active duty-day ledger rows for unpaid-day queries.';

commit;
