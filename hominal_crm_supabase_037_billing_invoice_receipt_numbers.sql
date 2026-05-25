-- Billing module upgrade: invoice + receipt numbering + paid status
-- - hh_billings.invoice_no  (sequence-backed, YYYY-NNNNNN format on first persist)
-- - hh_billings.paid_status (UNPAID | PARTIAL | PAID — service-maintained)
-- - hh_receipts.receipt_no  (sequence-backed)
-- - Helper RPCs to allocate the next invoice / receipt number atomically.

-- 1. Sequences (one per year-of-issue, year-stamped at insert time).
create sequence if not exists public.hh_invoice_seq
  start with 1
  increment by 1
  minvalue 1
  cache 1;

create sequence if not exists public.hh_receipt_seq
  start with 1
  increment by 1
  minvalue 1
  cache 1;

-- 2. Columns
alter table public.hh_billings
  add column if not exists invoice_no text,
  add column if not exists paid_status text default 'UNPAID';

alter table public.hh_receipts
  add column if not exists receipt_no text;

-- Status constraint (defensive — service is the source of truth).
alter table public.hh_billings
  drop constraint if exists chk_hh_billings_paid_status;
alter table public.hh_billings
  add constraint chk_hh_billings_paid_status
  check (paid_status in ('UNPAID', 'PARTIAL', 'PAID'));

-- 3. Allocator RPCs — atomic + RLS-safe.
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
  v_seq := nextval('public.hh_invoice_seq');
  return 'INV' || v_year || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.hh_next_receipt_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  v_seq bigint;
begin
  v_seq := nextval('public.hh_receipt_seq');
  return 'RCT' || v_year || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.hh_next_invoice_no() to authenticated;
grant execute on function public.hh_next_receipt_no() to authenticated;

-- 4. Backfill: assign numbers to historical rows in created_at order.
do $$
declare
  r record;
  v_year text;
  v_seq bigint;
begin
  for r in
    select id, created_at
    from public.hh_billings
    where invoice_no is null
    order by created_at asc, id asc
  loop
    v_year := to_char(coalesce(r.created_at, now()) at time zone 'Asia/Kolkata', 'YYYY');
    v_seq := nextval('public.hh_invoice_seq');
    update public.hh_billings
      set invoice_no = 'INV' || v_year || lpad(v_seq::text, 6, '0')
      where id = r.id;
  end loop;

  for r in
    select id, created_at
    from public.hh_receipts
    where receipt_no is null
    order by created_at asc, id asc
  loop
    v_year := to_char(coalesce(r.created_at, now()) at time zone 'Asia/Kolkata', 'YYYY');
    v_seq := nextval('public.hh_receipt_seq');
    update public.hh_receipts
      set receipt_no = 'RCT' || v_year || lpad(v_seq::text, 6, '0')
      where id = r.id;
  end loop;
end $$;

-- 5. Uniqueness once backfilled.
create unique index if not exists uq_hh_billings_invoice_no
  on public.hh_billings (invoice_no)
  where invoice_no is not null;

create unique index if not exists uq_hh_receipts_receipt_no
  on public.hh_receipts (receipt_no)
  where receipt_no is not null;
