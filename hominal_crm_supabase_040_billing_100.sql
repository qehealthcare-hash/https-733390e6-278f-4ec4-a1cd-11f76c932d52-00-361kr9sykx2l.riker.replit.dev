-- Billing module → 100: concurrency, atomic delete, period uniqueness, cleanup

-- 1. One MONTHLY invoice per (billing, period) — race-safe at DB level
create unique index if not exists uq_hh_invoices_monthly_period
  on public.hh_invoices (billing_id, period)
  where kind = 'MONTHLY' and period is not null;

-- 2. Drop orphan per-bill invoice_no (bill = account; invoices carry numbers)
drop index if exists public.uq_hh_billings_invoice_no;
alter table public.hh_billings drop column if exists invoice_no;

-- 3. Sequence allocators share one advisory lock (alloc + compact never race)
create or replace function public.hh_next_invoice_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  v_seq bigint;
begin
  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));
  v_seq := nextval('public.hh_invoice_seq');
  return 'INV' || v_year || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.hh_compact_invoice_seq()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));
  select coalesce(
    max(nullif(regexp_replace(invoice_no, '^INV[0-9]{4}', ''), '')::bigint),
    0
  )
  into v_max
  from public.hh_invoices
  where invoice_no ~ '^INV[0-9]{4}[0-9]+$';

  if v_max <= 0 then
    perform setval('public.hh_invoice_seq', 1, false);
  else
    perform setval('public.hh_invoice_seq', v_max, true);
  end if;
  return v_max;
end;
$$;

-- 4. Atomic invoice delete: detach receipts → delete → compact (single transaction)
create or replace function public.hominal_delete_invoice(
  p_invoice_id text,
  p_actor text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.hh_invoices%rowtype;
  v_detached integer := 0;
  v_status text;
begin
  if p_invoice_id is null or p_invoice_id = '' then
    raise exception 'invoice_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('hh_invoice_seq'));

  select * into v_inv
  from public.hh_invoices
  where id = p_invoice_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Invoice not found');
  end if;

  v_status := upper(coalesce(v_inv.status, ''));
  if v_status = 'PAID' then
    return jsonb_build_object(
      'ok', false,
      'code', 'BUSINESS',
      'message', 'Cannot delete a PAID invoice — void receipts first'
    );
  end if;

  update public.hh_receipts
  set invoice_id = null,
      updated_by = coalesce(nullif(p_actor, ''), updated_by)
  where invoice_id = p_invoice_id;
  get diagnostics v_detached = row_count;

  delete from public.hh_invoices where id = p_invoice_id;

  perform public.hh_compact_invoice_seq();

  return jsonb_build_object(
    'ok', true,
    'invoice_no', v_inv.invoice_no,
    'billing_id', v_inv.billing_id,
    'receipts_detached', v_detached
  );
end;
$$;

grant execute on function public.hominal_delete_invoice(text, text) to authenticated;
