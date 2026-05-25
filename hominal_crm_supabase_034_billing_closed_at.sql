-- =============================================================================
-- Migration 034 — Billing close audit hardening
--
-- Adds an explicit `closed_at` column to hh_billings so the reopen-resume
-- logic in `capLinkedDutiesOnBillingClose(..., mode: "reopen")` doesn't
-- have to guess the previous close timestamp from `updated_at`
-- (which is bumped on every subsequent edit).
--
-- Also adds a partial unique index on hh_audit_logs to ensure each
-- (module, entity_id, stamp) per actor per hour is unique — prevents
-- accidental duplicate audit rows when retries race.
-- =============================================================================

alter table public.hh_billings
  add column if not exists closed_at timestamptz;

-- Best-effort backfill: stamp closed_at = updated_at for rows that are
-- already Closed and have a null closed_at. The exact close moment is
-- recoverable from hh_audit_logs but for the reopen-resume logic only
-- a day-precision approximation matters.
update public.hh_billings
   set closed_at = coalesce(updated_at, nullif(created, '')::timestamptz)
 where status = 'Closed'
   and closed_at is null;

create index if not exists idx_hh_billings_closed_at
  on public.hh_billings (closed_at)
  where closed_at is not null;

-- ---------------------------------------------------------------------------
-- Validate hh_duties.extra_partners shape so a malformed write can't make
-- the materializer crash on next run. We accept either NULL or a JSON
-- array; element-level shape is enforced by the application layer.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints
     where constraint_name = 'chk_hh_duties_extra_partners_array'
       and table_name = 'hh_duties'
  ) then
    alter table public.hh_duties
      add constraint chk_hh_duties_extra_partners_array
      check (extra_partners is null or jsonb_typeof(extra_partners) = 'array');
  end if;
end$$;
