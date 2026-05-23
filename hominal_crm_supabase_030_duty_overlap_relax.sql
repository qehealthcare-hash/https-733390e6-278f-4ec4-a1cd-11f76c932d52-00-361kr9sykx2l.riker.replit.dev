-- Phase 30 — Allow relief / shared shifts: app-level confirm_staff_overlap only.
-- Safe to re-run.

begin;

alter table public.hh_duties
  drop constraint if exists hh_duties_no_overlap;

commit;
