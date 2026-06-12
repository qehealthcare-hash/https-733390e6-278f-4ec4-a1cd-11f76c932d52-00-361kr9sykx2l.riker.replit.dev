-- Hominal Healthcare CRM
-- Duty soft-delete: DELETED status + deleted_at timestamp.
--
-- Admin delete (?hard=1) now marks a duty DELETED instead of physically
-- removing the row. Billing/payout materialization and overlap checks treat
-- DELETED like CANCELLED — the duty disappears from the calendar but the
-- audit trail survives.

begin;

alter table public.hh_duties
  add column if not exists deleted_at timestamptz;

alter table public.hh_duties drop constraint if exists chk_hh_duties_status;
alter table public.hh_duties
  add constraint chk_hh_duties_status
  check (status in (
    'SCHEDULED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
    'DELETED'
  ));

create index if not exists idx_hh_duties_deleted_at
  on public.hh_duties (deleted_at)
  where deleted_at is not null;

commit;
