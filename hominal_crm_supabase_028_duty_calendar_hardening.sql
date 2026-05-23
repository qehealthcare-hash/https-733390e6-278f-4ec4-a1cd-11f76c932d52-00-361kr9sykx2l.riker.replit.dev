-- Phase 28 — Duty calendar / duty diary hardening (legacy svc_key parity).
-- Safe to re-run.

begin;

-- Duplicate patient FK on hh_duties (keep SET NULL variant).
alter table public.hh_duties drop constraint if exists hh_duties_patient_id_fk;

alter table public.hh_duties
  add column if not exists service_name text default '';

alter table public.hh_duties
  add column if not exists charge_per_day numeric(12, 2) not null default 0;

alter table public.hh_duties
  add column if not exists payout_per_day numeric(12, 2) not null default 0;

alter table public.hh_duties
  add column if not exists payout_term text not null default 'Daily';

alter table public.hh_duties
  add column if not exists extra_partners jsonb not null default '[]'::jsonb;

-- Backfill service_name from service_type where empty.
update public.hh_duties
set service_name = coalesce(nullif(trim(service_type), ''), 'Care Taker Services')
where coalesce(trim(service_name), '') = '';

-- Normalize partner_id before FKs (legacy rows used empty string or free-text names).
update public.hh_svc_entries
set partner_id = null
where coalesce(trim(partner_id), '') = ''
   or not exists (select 1 from public.hh_employees e where e.id = hh_svc_entries.partner_id);

update public.hh_payout_charges
set partner_id = null
where coalesce(trim(partner_id), '') = ''
   or not exists (select 1 from public.hh_employees e where e.id = hh_payout_charges.partner_id);

delete from public.hh_svc_entries s
where coalesce(trim(s.billing_id), '') <> ''
  and not exists (select 1 from public.hh_billings b where b.id = s.billing_id);

-- hh_svc_entries — billing FK + partner FK + idempotent day row
alter table public.hh_svc_entries
  drop constraint if exists hh_svc_entries_billing_id_fkey;

alter table public.hh_svc_entries
  add constraint hh_svc_entries_billing_id_fkey
  foreign key (billing_id) references public.hh_billings (id) on delete cascade;

alter table public.hh_svc_entries
  drop constraint if exists hh_svc_entries_partner_id_fkey;

alter table public.hh_svc_entries
  add constraint hh_svc_entries_partner_id_fkey
  foreign key (partner_id) references public.hh_employees (id) on delete set null;

-- Remove duplicate day rows before unique index (keep lowest id).
delete from public.hh_svc_entries a
using public.hh_svc_entries b
where a.id > b.id
  and a.billing_id = b.billing_id
  and a.service_name = b.service_name
  and a.date = b.date
  and coalesce(a.partner_id, '') = coalesce(b.partner_id, '');

delete from public.hh_payout_charges a
using public.hh_payout_charges b
where a.id > b.id
  and a.svc_key = b.svc_key
  and a.date = b.date
  and coalesce(a.partner_id, '') = coalesce(b.partner_id, '');

drop index if exists uq_hh_svc_entries_bill_service_day_partner;

create unique index if not exists uq_hh_svc_entries_bill_service_day_partner
  on public.hh_svc_entries (
    billing_id,
    service_name,
    date,
    coalesce(partner_id, '')
  );

-- hh_payout_charges — integrity
alter table public.hh_payout_charges
  drop constraint if exists hh_payout_charges_amount_nonneg;

alter table public.hh_payout_charges
  add constraint hh_payout_charges_amount_nonneg
  check (amount >= 0);

alter table public.hh_payout_charges
  drop constraint if exists hh_payout_charges_partner_id_fkey;

alter table public.hh_payout_charges
  add constraint hh_payout_charges_partner_id_fkey
  foreign key (partner_id) references public.hh_employees (id) on delete set null;

drop index if exists uq_hh_payout_charges_svc_day_partner;

create unique index if not exists uq_hh_payout_charges_svc_day_partner
  on public.hh_payout_charges (
    svc_key,
    date,
    coalesce(partner_id, '')
  );

create index if not exists idx_hh_payout_charges_partner_id
  on public.hh_payout_charges (partner_id)
  where coalesce(partner_id, '') <> '';

create index if not exists idx_hh_svc_entries_remarks_duty
  on public.hh_svc_entries (remarks)
  where remarks like 'duty:%';

commit;
