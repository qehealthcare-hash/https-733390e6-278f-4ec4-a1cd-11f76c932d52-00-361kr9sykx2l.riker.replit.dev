-- =============================================================
-- Hominal CRM — Migration 033
-- Duty calendar P2 hardening (audit follow-up)
--
-- Adds:
--   * Partial index on hh_duties for active subset (SCHEDULED / IN_PROGRESS)
--     so `findActiveByPatient`, `findActive`, and the daily extend cron stay
--     fast as the duty table grows past 100k rows.
--   * Per-patient + per-employee active-subset indexes used by overlap
--     lookups (`findOverlapping`, `findOverlappingForPatient`).
--
-- Safe to re-run.
-- =============================================================

set search_path = public;

create index if not exists idx_hh_duties_active
  on public.hh_duties (status)
  where status in ('SCHEDULED','IN_PROGRESS');

create index if not exists idx_hh_duties_active_patient
  on public.hh_duties (patient_id, start_at)
  where status in ('SCHEDULED','IN_PROGRESS');

create index if not exists idx_hh_duties_active_employee
  on public.hh_duties (employee_id, start_at)
  where status in ('SCHEDULED','IN_PROGRESS');

-- Open-ended duties (sentinel 2099-12-31) are the ones the daily cron
-- touches every night; cheap covering index so the cron's iteration
-- skips the bulk of the table without sequential scan.
create index if not exists idx_hh_duties_open_ended
  on public.hh_duties (end_at)
  where end_at >= '2099-01-01';
