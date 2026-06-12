-- P2-7: NOT NULL + CHECK on hh_duties / hh_inquiries / hh_attendance / hh_patients.status
-- (extends P1-13 billings/payouts coverage to the rest of the CRM schema).

begin;

-- Backfill NULLs (idempotent).
update public.hh_duties set status = 'SCHEDULED' where status is null;
update public.hh_inquiries set status = 'New' where status is null;
update public.hh_attendance set status = 'PRESENT' where status is null;
update public.hh_patients set status = 'Active' where status is null;

-- Normalize casing drift before CHECK (inquiry statuses are case-sensitive).
update public.hh_duties
   set status = upper(trim(status))
 where status is not null;

update public.hh_attendance
   set status = upper(trim(status))
 where status is not null;

update public.hh_patients
   set status = case lower(trim(status))
     when 'active' then 'Active'
     when 'on hold' then 'On Hold'
     when 'paused' then 'Paused'
     when 'duty closed' then 'Duty Closed'
     when 'closed' then 'Closed'
     when 'discharged' then 'Discharged'
     when 'deceased' then 'Deceased'
     when 'expired' then 'Expired'
     when 'inactive' then 'Inactive'
     else trim(status)
   end
 where status is not null;

alter table public.hh_duties alter column status set not null;
alter table public.hh_inquiries alter column status set not null;
alter table public.hh_attendance alter column status set not null;
alter table public.hh_patients alter column status set not null;

alter table public.hh_duties drop constraint if exists chk_hh_duties_status;
alter table public.hh_duties
  add constraint chk_hh_duties_status
  check (status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'));

alter table public.hh_inquiries drop constraint if exists chk_hh_inquiries_status;
alter table public.hh_inquiries
  add constraint chk_hh_inquiries_status
  check (status in ('New', 'Contacted', 'FollowUp', 'Negotiating', 'Converted', 'Closed', 'Lost'));

alter table public.hh_attendance drop constraint if exists chk_hh_attendance_status;
alter table public.hh_attendance
  add constraint chk_hh_attendance_status
  check (status in ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY'));

alter table public.hh_patients drop constraint if exists chk_hh_patients_status;
alter table public.hh_patients
  add constraint chk_hh_patients_status
  check (status in (
    'Active',
    'On Hold',
    'Paused',
    'Duty Closed',
    'Closed',
    'Discharged',
    'Deceased',
    'Expired',
    'Inactive'
  ));

create or replace function public.audit_probe_p2_7_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('hh_duties', 'hh_inquiries', 'hh_attendance', 'hh_patients')
       and c.column_name = 'status'
       and c.is_nullable <> 'NO'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_duties'
       and con.contype = 'c' and con.conname = 'chk_hh_duties_status'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_inquiries'
       and con.contype = 'c' and con.conname = 'chk_hh_inquiries_status'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_attendance'
       and con.contype = 'c' and con.conname = 'chk_hh_attendance_status'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_patients'
       and con.contype = 'c' and con.conname = 'chk_hh_patients_status'
  );
$$;

revoke all on function public.audit_probe_p2_7_ok() from public;
grant execute on function public.audit_probe_p2_7_ok() to service_role;

commit;
