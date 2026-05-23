-- Phase 31 — Add missing columns the API expects.
-- Safe to re-run.

begin;

alter table public.hh_employees
  add column if not exists photo jsonb;

alter table public.hh_patients
  add column if not exists status_reason text default '';

alter table public.hh_patients
  add column if not exists status_reason_other text default '';

commit;
