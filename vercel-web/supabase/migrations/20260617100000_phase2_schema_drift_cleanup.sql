-- Phase 2 SSOT: document and reconcile ledger / invoice id drift.
-- hh_svc_entries.id is uuid; hh_invoice_lines.svc_entry_id remains legacy bigint.

begin;

alter table public.hh_invoice_lines
  add column if not exists svc_entry_uuid uuid;

create index if not exists idx_hh_invoice_lines_svc_entry_uuid
  on public.hh_invoice_lines (svc_entry_uuid)
  where svc_entry_uuid is not null;

alter table public.hh_invoice_lines
  drop constraint if exists hh_invoice_lines_svc_entry_uuid_fkey;

alter table public.hh_invoice_lines
  add constraint hh_invoice_lines_svc_entry_uuid_fkey
  foreign key (svc_entry_uuid) references public.hh_svc_entries(id)
  on delete set null not valid;

alter table public.hh_invoice_lines
  validate constraint hh_invoice_lines_svc_entry_uuid_fkey;

-- Tracked DDL: payout charge denormalized bill context (already live in prod).
alter table public.hh_payout_charges
  add column if not exists billing_id text;

alter table public.hh_payout_charges
  add column if not exists service_name text;

comment on column public.hh_svc_entries.id is
  'UUID primary key (duty-calendar rows default gen_random_uuid()).';

comment on column public.hh_invoice_lines.svc_entry_id is
  'Legacy bigint service-entry reference; null for duty-calendar uuid rows.';

comment on column public.hh_invoice_lines.svc_entry_uuid is
  'FK to hh_svc_entries.id for duty-calendar invoice line snapshots.';

comment on column public.hh_payout_charges.billing_id is
  'Denormalized patient bill id from duty materialization.';

comment on column public.hh_payout_charges.service_name is
  'Denormalized service label from duty materialization.';

commit;
