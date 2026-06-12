-- Hominal Healthcare CRM
-- Permanent, DB-level guard: the SAME carer can never hold two overlapping
-- ACTIVE duties for the SAME patient.
--
-- Why: two open-ended duties for the same (patient, employee) pair silently
-- doubled the materialized billing + payout rows (the duty-calendar drift we
-- repaired by hand). The application layer now hard-blocks this, but the
-- application is not the only writer (imports / RPCs / manual fixes), so we
-- enforce it in Postgres as the last line of defence.
--
-- Relief / partner-share is always a *different* employee, so this constraint
-- never blocks a legitimate booking. CANCELLED / NO_SHOW / DELETED rows are
-- excluded from the guard so a cancelled duty can be replaced in place.

begin;

create extension if not exists btree_gist;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'hh_duties_patient_emp_no_overlap'
      and conrelid = 'public.hh_duties'::regclass
  ) then
    alter table public.hh_duties drop constraint hh_duties_patient_emp_no_overlap;
  end if;
end;
$$;

alter table public.hh_duties
  add constraint hh_duties_patient_emp_no_overlap
  exclude using gist (
    patient_id with =,
    employee_id with =,
    tstzrange(start_at, end_at) with &&
  )
  where (upper(coalesce(status, '')) not in ('CANCELLED', 'NO_SHOW', 'DELETED'));

comment on constraint hh_duties_patient_emp_no_overlap on public.hh_duties is
  'Blocks two overlapping active duties for the same (patient_id, employee_id). '
  'Relief/partner-share uses a different employee. Excludes CANCELLED/NO_SHOW/DELETED.';

commit;
