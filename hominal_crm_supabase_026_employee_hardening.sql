-- Phase 26 — Employee module hardening (mirrors patient 024).
-- Safe to re-run.

begin;

-- Service-layer audit already records actor + stamp; trigger duplicates rows.
drop trigger if exists trg_audit_hh_employees on public.hh_employees;

alter table public.hh_employees
  drop constraint if exists hh_employees_status_check;

alter table public.hh_employees
  add constraint hh_employees_status_check
  check (
    status is null
    or status in ('Active', 'Inactive', 'OnLeave', 'Suspended')
  );

-- Referential integrity from operational tables.
alter table public.hh_duties
  drop constraint if exists hh_duties_employee_id_fkey;

alter table public.hh_duties
  add constraint hh_duties_employee_id_fkey
  foreign key (employee_id) references public.hh_employees (id) on delete restrict;

alter table public.hh_attendance
  drop constraint if exists hh_attendance_employee_id_fkey;

alter table public.hh_attendance
  add constraint hh_attendance_employee_id_fkey
  foreign key (employee_id) references public.hh_employees (id) on delete restrict;

alter table public.hh_payouts
  drop constraint if exists hh_payouts_employee_id_fkey;

alter table public.hh_payouts
  add constraint hh_payouts_employee_id_fkey
  foreign key (employee_id) references public.hh_employees (id) on delete restrict;

alter table public.hh_patients
  drop constraint if exists hh_patients_caretaker_id_fkey;

alter table public.hh_patients
  add constraint hh_patients_caretaker_id_fkey
  foreign key (caretaker_id) references public.hh_employees (id) on delete restrict;

create index if not exists idx_hh_employees_aadhar
  on public.hh_employees (aadhar)
  where coalesce(aadhar, '') <> '';

commit;
