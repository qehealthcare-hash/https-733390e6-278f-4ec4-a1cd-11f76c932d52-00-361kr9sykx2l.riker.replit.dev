-- Payout module → 100: paid-transaction serials, proof attachments,
--                    multi-disbursement (advance + final), period-scoped
--                    "pending payout" sourced from the duty calendar.
--
-- Safe to re-run. Wrap in a single transaction.

begin;

-- ── 1. hh_paid_transactions: serial / proof / payout linkage ───────────────
--
-- Today the table is keyed by `id` (= payout id, one row per payout). We
-- relax that contract so a single payout can have multiple disbursements
-- (advance + balance) while keeping backward compatibility for existing rows.

alter table public.hh_paid_transactions
  add column if not exists serial_no text,
  add column if not exists payout_id text,
  add column if not exists period_month text,
  add column if not exists tx_kind text default 'FINAL',
  add column if not exists proof_bucket text,
  add column if not exists proof_path text,
  add column if not exists created_by text default '',
  add column if not exists updated_by text default '';

-- tx_kind must be ADVANCE or FINAL (allow legacy NULL → coerced via update)
update public.hh_paid_transactions
set tx_kind = 'FINAL'
where tx_kind is null;

alter table public.hh_paid_transactions
  drop constraint if exists chk_hh_paid_tx_kind;

alter table public.hh_paid_transactions
  add constraint chk_hh_paid_tx_kind
  check (tx_kind in ('ADVANCE', 'FINAL'));

-- Backfill payout_id = id for the legacy 1:1 rows so historical disbursements
-- still link to their payout once the FK is exposed via the API.
update public.hh_paid_transactions
set payout_id = id
where payout_id is null
  and exists (
    select 1 from public.hh_payouts po where po.id = hh_paid_transactions.id
  );

-- Backfill period_month from paid_on (IST month) for fast period queries.
update public.hh_paid_transactions
set period_month = to_char(
  (case
    when paid_on ~ '^\d{4}-\d{2}-\d{2}' then paid_on::date
    else coalesce(created_at, now())::date
  end),
  'YYYY-MM'
)
where period_month is null
  and (paid_on is not null or created_at is not null);

-- ── 2. Serial sequence + allocator (PTXYYYY000001 format) ──────────────────

create sequence if not exists public.hh_paid_tx_seq start with 1;

create or replace function public.hh_next_paid_tx_serial()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
  v_seq bigint;
begin
  -- Advisory lock so concurrent disbursements can't draw the same serial.
  perform pg_advisory_xact_lock(hashtext('hh_paid_tx_seq'));
  v_seq := nextval('public.hh_paid_tx_seq');
  return 'PTX' || v_year || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.hh_next_paid_tx_serial() to authenticated;

-- Backfill serial_no on existing rows (deterministic by created_at order)
-- so the legacy ledger has audit-grade numbers too.
do $$
declare
  v_year text;
  v_seq bigint := 0;
  r record;
begin
  if not exists (
    select 1 from public.hh_paid_transactions where serial_no is null or serial_no = ''
  ) then
    return;
  end if;

  for r in
    select id, created_at
    from public.hh_paid_transactions
    where serial_no is null or serial_no = ''
    order by coalesce(created_at, now()) asc, id asc
  loop
    v_year := to_char(coalesce(r.created_at, now()) at time zone 'Asia/Kolkata', 'YYYY');
    v_seq := v_seq + 1;
    update public.hh_paid_transactions
    set serial_no = 'PTX' || v_year || lpad(v_seq::text, 6, '0')
    where id = r.id;
  end loop;

  -- Reseed the sequence past the highest issued serial so new allocations
  -- never collide with backfilled numbers.
  perform setval(
    'public.hh_paid_tx_seq',
    greatest(
      v_seq,
      coalesce(
        (select max(nullif(regexp_replace(serial_no, '^PTX[0-9]{4}', ''), '')::bigint)
           from public.hh_paid_transactions
          where serial_no ~ '^PTX[0-9]{4}[0-9]+$'),
        0
      )
    ),
    true
  );
end;
$$;

-- Once backfill is guaranteed-complete, enforce uniqueness.
create unique index if not exists uq_hh_paid_tx_serial
  on public.hh_paid_transactions (serial_no)
  where serial_no is not null;

-- Period + employee lookup index for the pending-from-duty-calendar query.
create index if not exists idx_hh_paid_tx_period_employee
  on public.hh_paid_transactions (period_month, employee_id)
  where period_month is not null;

create index if not exists idx_hh_paid_tx_payout
  on public.hh_paid_transactions (payout_id)
  where payout_id is not null;

-- ── 3. "Pending payout for employee + period" RPC ──────────────────────────
--
-- Single source of truth for the duty-calendar pending pill and the payouts
-- page outstanding panel. Works even before an `hh_payouts` row exists.
--
--   charged = sum(hh_payout_charges.amount) for partner-id or legacy
--             remarks fallback, bucketed into YYYY-MM via `date` or `created_at`.
--   paid    = sum(hh_paid_transactions.amount) for the same employee in the
--             same period (preferring the new `period_month` column,
--             falling back to `paid_on` parsed as a date).
--   pending = max(charged - paid, 0)

create or replace function public.hh_employee_pending_payout(
  p_employee_id text,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged numeric := 0;
  v_paid numeric := 0;
  v_duty_count integer := 0;
begin
  if p_employee_id is null or p_employee_id = '' then
    raise exception 'employee_id is required';
  end if;
  if p_period is null or p_period = '' then
    raise exception 'period is required (YYYY-MM)';
  end if;

  -- 1. Charged from duty calendar (hh_payout_charges)
  select
    coalesce(sum(amount), 0),
    count(*)
  into v_charged, v_duty_count
  from public.hh_payout_charges
  where (
    partner_id = p_employee_id
    or partner = p_employee_id
    or (coalesce(partner, '') = '' and coalesce(remarks, '') ilike '%' || p_employee_id || '%')
  )
  and (
    substr(coalesce(date, ''), 1, 7) = p_period
    or to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period
  );

  -- 2. Paid (advance + final) for the same employee + period
  select coalesce(sum(amount), 0)
  into v_paid
  from public.hh_paid_transactions
  where (
    employee_id = p_employee_id
    or (coalesce(employee_id, '') = '' and partner = p_employee_id)
  )
  and (
    period_month = p_period
    or (
      coalesce(period_month, '') = ''
      and paid_on ~ '^\d{4}-\d{2}-\d{2}'
      and to_char(paid_on::date, 'YYYY-MM') = p_period
    )
  );

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'period_month', p_period,
    'charged', v_charged,
    'paid', v_paid,
    'pending', greatest(v_charged - v_paid, 0),
    'duty_count', v_duty_count
  );
end;
$$;

grant execute on function public.hh_employee_pending_payout(text, text) to authenticated;

-- ── 4. Extend signed-download guard to cover payout-proofs bucket ──────────
--
-- Mirrors the existing patient-documents / employee-documents whitelist so
-- `/api/v1/uploads/signed-download` can mint URLs only for paths that are
-- actually referenced by an hh_paid_transactions row.

create or replace function public.crm_storage_path_in_use(p_bucket text, p_path text)
returns boolean
language sql
stable
as $$
  select case p_bucket
    when 'patient-documents' then exists (
      select 1
      from public.hh_patients p
      where (p.photo is not null and p.photo->>'path' = p_path)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(p.docs, '[]'::jsonb)) el
           where el->>'path' = p_path
         )
    )
    when 'employee-documents' then exists (
      select 1
      from public.hh_employees e
      where (e.photo is not null and e.photo->>'path' = p_path)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(e.docs, '[]'::jsonb)) el
           where el->>'path' = p_path
         )
    )
    when 'payout-proofs' then exists (
      select 1
      from public.hh_paid_transactions pt
      where pt.proof_path = p_path and coalesce(pt.proof_bucket, '') = 'payout-proofs'
    )
    else false
  end;
$$;

-- ── 5. Storage bucket + RLS ────────────────────────────────────────────────
--
-- Idempotent create + tight RLS so payout proofs can only be read/written
-- by authenticated CRM users.

insert into storage.buckets (id, name, public)
values ('payout-proofs', 'payout-proofs', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'payout_proofs_authenticated_read'
  ) then
    create policy payout_proofs_authenticated_read
      on storage.objects for select
      to authenticated
      using (bucket_id = 'payout-proofs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'payout_proofs_authenticated_write'
  ) then
    create policy payout_proofs_authenticated_write
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'payout-proofs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'payout_proofs_authenticated_update'
  ) then
    create policy payout_proofs_authenticated_update
      on storage.objects for update
      to authenticated
      using (bucket_id = 'payout-proofs')
      with check (bucket_id = 'payout-proofs');
  end if;
end;
$$;

commit;
