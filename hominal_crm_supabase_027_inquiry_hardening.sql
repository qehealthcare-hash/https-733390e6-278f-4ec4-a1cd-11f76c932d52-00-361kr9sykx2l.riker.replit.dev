-- Phase 27 — Inquiry module hardening (mirrors patient 024 / employee 026).
-- Safe to re-run.

begin;

drop trigger if exists trg_audit_hh_inquiries on public.hh_inquiries;

-- Normalise invalid assignees before FK (e.g. legacy 'admin' username).
update public.hh_inquiries
set assigned_to = null
where coalesce(nullif(trim(assigned_to), ''), '') = ''
   or not exists (
     select 1 from public.hh_employees e where e.id = hh_inquiries.assigned_to
   );

update public.hh_inquiries
set potential = upper(trim(potential))
where coalesce(potential, '') <> '';

alter table public.hh_inquiries
  drop constraint if exists hh_inquiries_status_check;

alter table public.hh_inquiries
  add constraint hh_inquiries_status_check
  check (
    status is null
    or status in (
      'New', 'Contacted', 'FollowUp', 'Negotiating',
      'Converted', 'Closed', 'Lost'
    )
  );

alter table public.hh_inquiries
  drop constraint if exists hh_inquiries_potential_check;

alter table public.hh_inquiries
  add constraint hh_inquiries_potential_check
  check (
    potential is null
    or potential in ('HOT', 'WARM', 'COLD')
  );

alter table public.hh_inquiries
  drop constraint if exists hh_inquiries_assigned_to_fkey;

alter table public.hh_inquiries
  add constraint hh_inquiries_assigned_to_fkey
  foreign key (assigned_to) references public.hh_employees (id) on delete set null;

create index if not exists idx_hh_inquiries_status on public.hh_inquiries (status);

create index if not exists idx_hh_inquiries_followup_date
  on public.hh_inquiries (followup_date)
  where coalesce(followup_date, '') <> '';

commit;
