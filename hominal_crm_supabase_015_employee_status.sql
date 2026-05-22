-- Phase 15 — Optional employee.status column (additive).
-- Production today uses leave_date as the inactive marker; the API layer maps
-- status ↔ leave_date until this column is applied.
-- Safe to re-run.

begin;

alter table if exists public.hh_employees
  add column if not exists status text default 'Active';

update public.hh_employees
set status = case
  when coalesce(nullif(trim(leave_date), ''), '') <> '' then 'Inactive'
  else coalesce(nullif(trim(status), ''), 'Active')
end
where coalesce(nullif(trim(status), ''), '') = ''
   or status is null;

create index if not exists idx_hh_employees_status on public.hh_employees (status);

commit;
