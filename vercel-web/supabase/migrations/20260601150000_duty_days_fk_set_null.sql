-- P0-A / P1-45 follow-up: allow svc_entry removal while preserving ledger rows.
--
-- RESTRICT (20260601140000) blocked duty cancel, hard-delete, and hominal_dedup_billing_diary
-- whenever hh_duty_days still referenced the svc_entry. SET NULL keeps the ledger row
-- (deleted_at / paid_* columns intact) and clears svc_entry_id when the parent row is removed.
--
-- No data is deleted by this migration.

begin;

alter table public.hh_duty_days
  alter column svc_entry_id drop not null;

alter table public.hh_duty_days
  drop constraint if exists hh_duty_days_svc_entry_id_fkey;

alter table public.hh_duty_days
  add constraint hh_duty_days_svc_entry_id_fkey
  foreign key (svc_entry_id) references public.hh_svc_entries(id) on delete set null;

commit;
