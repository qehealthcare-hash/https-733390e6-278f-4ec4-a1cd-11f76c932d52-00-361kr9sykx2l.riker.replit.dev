-- =============================================================================
-- Migration 048 — hh_duty_days ledger (Phase 11)
--
-- Single source of truth that joins patient billing receipts and staff payout
-- charges per service day. Lifts Billing and Payout dimensions in the
-- enterprise readiness scorecard from ~57 to 85+ by allowing the application
-- (and reporting/audit) to answer "for THIS day of THIS duty, who has been
-- billed and who has been paid?" without scanning svc_entries × receipts ×
-- payout_charges by hand.
--
-- This migration is ADDITIVE:
--   - The ledger is written in parallel with the existing receipt and payout
--     paths. No legacy RPC is replaced in this phase. Cut-over of
--     `hominal_save_receipt` / payout RPCs to the ledger is Phase 11b.
--   - Writes are restricted to the service role. RLS allows only active app
--     users to read.
--
-- Schema mismatches from the original spec (documented in the readiness doc):
--   - `hh_svc_entries.id` is `uuid` (default `gen_random_uuid()`), not text.
--     `hh_duty_days.svc_entry_id` is therefore `uuid` to keep the FK valid.
--   - `hh_payout_charges.id` is also `uuid`, so `paid_charge_id` is `uuid`.
--   - `hh_billings.id`, `hh_patients.id`, `hh_employees.id`, `hh_receipts.id`
--     are all `text` — those FKs stay `text` per the spec.
-- =============================================================================

begin;

-- ── 1. Ledger table ─────────────────────────────────────────────────────────

create table if not exists public.hh_duty_days (
  id uuid primary key default gen_random_uuid(),
  svc_entry_id uuid not null references public.hh_svc_entries(id) on delete cascade,
  billing_id text references public.hh_billings(id) on delete set null,
  patient_id text references public.hh_patients(id) on delete set null,
  employee_id text references public.hh_employees(id) on delete set null,
  service_name text not null,
  service_date date not null,
  shift_type text,
  patient_rate numeric(12,2),
  staff_rate numeric(12,2),
  paid_receipt_id text references public.hh_receipts(id) on delete set null,
  paid_charge_id uuid references public.hh_payout_charges(id) on delete set null,
  paid_to_patient_at timestamptz,
  paid_to_staff_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  deleted_by text,
  constraint hh_duty_days_shift_type_check
    check (shift_type is null or shift_type in ('am', 'pm', 'full', 'night'))
);

comment on table public.hh_duty_days is
  'Per-day ledger linking svc_entries, billing receipts, and payout charges. '
  'Service-role write only; authenticated reads via hh_is_active_app_user().';

-- ── 2. Indexes ─────────────────────────────────────────────────────────────

-- Unique active day-row per svc_entry × service_date (filtered partial index
-- so soft-deleted rows can coexist with re-issued live rows).
create unique index if not exists uq_hh_duty_days_svc_entry_day_active
  on public.hh_duty_days(svc_entry_id, service_date)
  where deleted_at is null;

create index if not exists idx_hh_duty_days_patient_date
  on public.hh_duty_days(patient_id, service_date);

create index if not exists idx_hh_duty_days_employee_date
  on public.hh_duty_days(employee_id, service_date);

create index if not exists idx_hh_duty_days_billing_deleted
  on public.hh_duty_days(billing_id, deleted_at);

create index if not exists idx_hh_duty_days_paid_receipt
  on public.hh_duty_days(paid_receipt_id);

create index if not exists idx_hh_duty_days_paid_charge
  on public.hh_duty_days(paid_charge_id);

-- ── 3. updated_at trigger ──────────────────────────────────────────────────

drop trigger if exists update_hh_duty_days_updated_at on public.hh_duty_days;
create trigger update_hh_duty_days_updated_at
  before update on public.hh_duty_days
  for each row execute function public.hh_set_updated_at();

-- ── 4. RLS — read for active users, no write for non-service callers ───────

alter table public.hh_duty_days enable row level security;

drop policy if exists hh_duty_days_read on public.hh_duty_days;
create policy hh_duty_days_read
  on public.hh_duty_days
  for select
  to authenticated
  using (public.hh_is_active_app_user());

-- Intentionally NO insert/update/delete policy — service role bypasses RLS
-- and is the only writer until Phase 11b transactional RPCs ship.

-- Lock down direct table grants so PostgREST cannot mutate via authenticated
-- clients even if the policy set ever drifts.
revoke insert, update, delete on public.hh_duty_days from anon, authenticated;
grant select on public.hh_duty_days to authenticated;

-- ── 5. Idempotent backfill function ────────────────────────────────────────
--
-- Expands every non-deleted svc_entry into per-day duty-day rows. Safe to
-- re-run: ON CONFLICT (svc_entry_id, service_date) WHERE deleted_at IS NULL
-- updates the existing row's billing/patient/employee/rate fields without
-- touching paid_* columns or deleted_at.
--
-- Notes on the source schema:
--   - hh_svc_entries.date is text in YYYY-MM-DD form (validated via regex).
--   - hh_svc_entries.count represents the number of days the entry spans.
--     Observed production data: all 25 svc rows have count = 1, so each row
--     maps 1:1 to a duty-day. The function still handles count > 1 for
--     forward-compat (the legacy SPA used to write multi-day rows).
--   - Staff rate is best-effort joined from hh_payout_charges via svc_key +
--     date + partner_id. Missing match = staff_rate stays NULL (operator
--     can backfill via the duty-diary editor later).
--   - hh_svc_entries has no deleted_at column today; we iterate all rows.

create or replace function public.hh_duty_days_backfill_from_svc_entries()
returns table(processed bigint, skipped bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processed bigint := 0;
  v_skipped   bigint := 0;
  r           record;
  v_count     int;
  v_base_dt   date;
  v_dt        date;
  v_offset    int;
  v_staff_rate numeric(12,2);
begin
  for r in
    select
      s.id                                 as svc_entry_id,
      s.svc_key                            as svc_key,
      nullif(s.billing_id, '')             as billing_id,
      s.service_name                       as service_name,
      nullif(s.partner_id, '')             as employee_id,
      s.date                               as service_date_text,
      coalesce(nullif(s.count, 0), 1)::int as days_count,
      s.amt::numeric(12,2)                 as patient_rate,
      b.patient_id                         as patient_id
    from public.hh_svc_entries s
    left join public.hh_billings b on b.id = nullif(s.billing_id, '')
  loop
    if r.service_date_text is null or r.service_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_base_dt := r.service_date_text::date;
    v_count := greatest(coalesce(r.days_count, 1), 1);

    for v_offset in 0 .. (v_count - 1) loop
      v_dt := v_base_dt + v_offset;
      v_staff_rate := null;

      select pc.amount::numeric(12,2)
        into v_staff_rate
        from public.hh_payout_charges pc
       where pc.svc_key = r.svc_key
         and pc.date    = to_char(v_dt, 'YYYY-MM-DD')
         and pc.partner_id is not distinct from r.employee_id
       limit 1;

      insert into public.hh_duty_days (
        svc_entry_id, billing_id, patient_id, employee_id,
        service_name, service_date, patient_rate, staff_rate,
        created_by, updated_by
      )
      values (
        r.svc_entry_id, r.billing_id, r.patient_id, r.employee_id,
        r.service_name, v_dt, r.patient_rate, v_staff_rate,
        'system:backfill', 'system:backfill'
      )
      on conflict (svc_entry_id, service_date) where deleted_at is null
      do update set
        billing_id   = excluded.billing_id,
        patient_id   = excluded.patient_id,
        employee_id  = excluded.employee_id,
        service_name = excluded.service_name,
        patient_rate = excluded.patient_rate,
        staff_rate   = excluded.staff_rate,
        updated_by   = 'system:backfill';

      v_processed := v_processed + 1;
    end loop;
  end loop;

  return query select v_processed, v_skipped;
end;
$$;

comment on function public.hh_duty_days_backfill_from_svc_entries() is
  'Idempotent backfill of hh_duty_days from hh_svc_entries. Service-role only.';

revoke all on function public.hh_duty_days_backfill_from_svc_entries() from public, anon, authenticated;

-- ── 6. Initial backfill ────────────────────────────────────────────────────

do $$
declare
  v_proc bigint;
  v_skip bigint;
begin
  select processed, skipped
    into v_proc, v_skip
    from public.hh_duty_days_backfill_from_svc_entries();
  raise notice 'hh_duty_days_ledger_048: backfilled processed=% skipped=%', v_proc, v_skip;
end $$;

commit;
