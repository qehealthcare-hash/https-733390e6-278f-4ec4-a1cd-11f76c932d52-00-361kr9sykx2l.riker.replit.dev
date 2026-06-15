-- Phase 2 SSOT: persist duty_id on ledger rows + FK to hh_duties.
-- Remarks remain the slot key; duty_id enables indexed lookups and referential integrity.

begin;

-- ── columns + indexes ──────────────────────────────────────────────────────

alter table public.hh_svc_entries
  add column if not exists duty_id text;

alter table public.hh_payout_charges
  add column if not exists duty_id text;

create index if not exists idx_hh_svc_entries_duty_id
  on public.hh_svc_entries (duty_id)
  where duty_id is not null;

create index if not exists idx_hh_payout_charges_duty_id
  on public.hh_payout_charges (duty_id)
  where duty_id is not null;

-- ── backfill from remarks (enable ledger write flag for protection trigger) ─

do $backfill$
begin
  perform set_config('hominal.duty_ledger_write', '1', true);

  update public.hh_svc_entries s
  set duty_id = (regexp_match(s.remarks, '^duty:([^:]+):'))[1]
  where coalesce(s.remarks, '') like 'duty:%'
    and s.duty_id is null;

  update public.hh_payout_charges p
  set duty_id = (regexp_match(p.remarks, '^duty:([^:]+):'))[1]
  where coalesce(p.remarks, '') like 'duty:%'
    and p.duty_id is null;
end;
$backfill$;

-- ── FK (orphan pre-check: hominal_billing_duty_reconcile should be clean) ──

alter table public.hh_svc_entries
  drop constraint if exists hh_svc_entries_duty_id_fkey;

alter table public.hh_svc_entries
  add constraint hh_svc_entries_duty_id_fkey
  foreign key (duty_id) references public.hh_duties(id)
  on delete restrict not valid;

alter table public.hh_payout_charges
  drop constraint if exists hh_payout_charges_duty_id_fkey;

alter table public.hh_payout_charges
  add constraint hh_payout_charges_duty_id_fkey
  foreign key (duty_id) references public.hh_duties(id)
  on delete restrict not valid;

alter table public.hh_svc_entries validate constraint hh_svc_entries_duty_id_fkey;
alter table public.hh_payout_charges validate constraint hh_payout_charges_duty_id_fkey;

-- ── auto-sync duty_id from remarks for RPC/cron writers ─────────────────────

create or replace function public.hh_sync_ledger_duty_id_from_remarks()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.remarks, '') like 'duty:%' then
    new.duty_id := coalesce(
      new.duty_id,
      (regexp_match(new.remarks, '^duty:([^:]+):'))[1]
    );
  end if;
  return new;
end;
$$;

drop trigger if exists hh_svc_entries_sync_duty_id on public.hh_svc_entries;
create trigger hh_svc_entries_sync_duty_id
  before insert or update of remarks, duty_id on public.hh_svc_entries
  for each row execute function public.hh_sync_ledger_duty_id_from_remarks();

drop trigger if exists hh_payout_charges_sync_duty_id on public.hh_payout_charges;
create trigger hh_payout_charges_sync_duty_id
  before insert or update of remarks, duty_id on public.hh_payout_charges
  for each row execute function public.hh_sync_ledger_duty_id_from_remarks();

commit;
