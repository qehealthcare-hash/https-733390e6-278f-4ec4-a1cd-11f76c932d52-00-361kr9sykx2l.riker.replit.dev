-- Invoice cancellation policy:
-- - Cancel now means HARD DELETE (row + lines disappear from the system).
-- - After deletion we compact the invoice number sequence so subsequent
--   generations continue without gaps.
-- - Receipts that were applied to a deleted invoice are detached
--   (invoice_id → NULL) so they remain on the bill as on-account credit.
--
-- This migration also purges any existing CANCELLED invoices so the UI
-- stops surfacing them.

-- 1. Detach receipts of invoices we are about to delete.
update public.hh_receipts r
  set invoice_id = null,
      updated_at = now()
  from public.hh_invoices i
  where r.invoice_id = i.id
    and upper(coalesce(i.status, '')) = 'CANCELLED';

-- 2. Hard delete the cancelled invoices (cascade removes hh_invoice_lines).
delete from public.hh_invoices
  where upper(coalesce(status, '')) = 'CANCELLED';

-- 3. Compactor RPC — sets the invoice sequence to MAX(seq_part) of the
--    actual hh_invoices rows. Safe to call after every delete.
create or replace function public.hh_compact_invoice_seq()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint := 0;
  v_curr bigint;
begin
  select coalesce(
    max(
      nullif(regexp_replace(invoice_no, '^INV[0-9]{4}', ''), '')::bigint
    ),
    0
  )
  into v_max
  from public.hh_invoices
  where invoice_no ~ '^INV[0-9]{4}[0-9]+$';

  select last_value into v_curr from public.hh_invoice_seq;
  if v_max < v_curr then
    perform setval('public.hh_invoice_seq', greatest(1, v_max), true);
  end if;
  return v_max;
end;
$$;

grant execute on function public.hh_compact_invoice_seq() to authenticated;

-- 4. Run the compactor once so the sequence resumes immediately after the
--    purge above.
select public.hh_compact_invoice_seq();
