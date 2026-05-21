begin;

alter table public.hh_receipts add column if not exists patient_id text default '';
alter table public.hh_receipts add column if not exists service_type text default '';
alter table public.hh_receipts add column if not exists bill_mode text default '';
alter table public.hh_receipts add column if not exists from_date text default '';
alter table public.hh_receipts add column if not exists to_date text default '';
alter table public.hh_receipts add column if not exists paid_days numeric(12,2) not null default 0;
alter table public.hh_receipts add column if not exists paid_dates jsonb not null default '[]'::jsonb;

alter table public.hh_svc_entries add column if not exists billing_id text default '';
alter table public.hh_svc_entries add column if not exists service_name text default '';

create index if not exists hh_receipts_billing_id_idx on public.hh_receipts (billing_id);
create index if not exists hh_receipts_patient_id_idx on public.hh_receipts (patient_id);
create index if not exists hh_svc_entries_svc_key_idx on public.hh_svc_entries (svc_key);
create index if not exists hh_svc_entries_billing_id_idx on public.hh_svc_entries (billing_id);

grant select, insert, update, delete on public.hh_receipts to authenticated;
grant select, insert, update, delete on public.hh_svc_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.hh_receipts enable row level security;
alter table public.hh_svc_entries enable row level security;

drop policy if exists hh_receipts_authenticated_access on public.hh_receipts;
create policy hh_receipts_authenticated_access
on public.hh_receipts
for all
to authenticated
using (public.hh_is_active_app_user())
with check (public.hh_is_active_app_user());

drop policy if exists hh_svc_entries_authenticated_access on public.hh_svc_entries;
create policy hh_svc_entries_authenticated_access
on public.hh_svc_entries
for all
to authenticated
using (public.hh_is_active_app_user())
with check (public.hh_is_active_app_user());

commit;
