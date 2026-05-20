-- Phase 3: RLS + RPC hardening for Hominal legacy CRM (SAFE / ADDITIVE ONLY)
-- Apply in Supabase SQL Editor AFTER hominal_crm_supabase_hardening.sql
-- Does NOT drop tables, truncate data, or delete rows (except duplicate cleanup in section A).
--
-- Fixes:
-- 1) Ensures billing RPCs exist and use text date columns (matches hh_receipts schema)
-- 2) Restores hh_lookup_login for anon (required before JWT exists at login)
-- 3) Improves hh_is_active_app_user() email/username matching
-- 4) Ensures active admin row exists in hh_users (insert-only if missing)
-- 5) RLS on hh_audit_logs + optional invoice tables

begin;

-- ── A) Schema columns (idempotent) ─────────────────────────────────────────
alter table if exists public.hh_receipts
  add column if not exists patient_id text,
  add column if not exists service_type text,
  add column if not exists bill_mode text,
  add column if not exists from_date text,
  add column if not exists to_date text,
  add column if not exists paid_days numeric default 0,
  add column if not exists paid_dates jsonb default '[]'::jsonb,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_by text,
  add column if not exists deleted_by text;

alter table if exists public.hh_paid_transactions
  add column if not exists employee_id text,
  add column if not exists patient_id text,
  add column if not exists patient_name text,
  add column if not exists service_type text,
  add column if not exists svc_key text,
  add column if not exists payout_mode text,
  add column if not exists from_date text,
  add column if not exists to_date text,
  add column if not exists paid_days numeric default 0,
  add column if not exists paid_dates jsonb default '[]'::jsonb,
  add column if not exists remarks text;

alter table if exists public.hh_svc_entries
  add column if not exists partner_id text;

create table if not exists public.hh_audit_logs (
  id bigserial primary key,
  module text not null,
  entity_id text,
  action text not null,
  stamp text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Remove exact duplicate legacy rows only (keeps one copy of each duplicate set).
delete from public.hh_svc_entries a
using public.hh_svc_entries b
where a.ctid < b.ctid
  and coalesce(a.svc_key,'') = coalesce(b.svc_key,'')
  and coalesce(a.date,'') = coalesce(b.date,'')
  and coalesce(a.partner,'') = coalesce(b.partner,'')
  and coalesce(a.service_name,'') = coalesce(b.service_name,'')
  and coalesce(a.freq,'') = coalesce(b.freq,'');

delete from public.hh_payout_charges a
using public.hh_payout_charges b
where a.ctid < b.ctid
  and coalesce(a.svc_key,'') = coalesce(b.svc_key,'')
  and coalesce(a.date,'') = coalesce(b.date,'')
  and coalesce(a.partner,'') = coalesce(b.partner,'')
  and coalesce(a.term,'') = coalesce(b.term,'');

create unique index if not exists uq_hh_receipts_id on public.hh_receipts (id);
create index if not exists idx_hh_receipts_billing_visible on public.hh_receipts (billing_id, deleted_at);

-- ── B) Auth helpers ─────────────────────────────────────────────────────────
create or replace function public.hh_auth_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.hh_is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.hh_users u
    where coalesce(u.is_active, false) = true
      and (
        lower(coalesce(u.email, '')) = public.hh_auth_email()
        or (
          public.hh_auth_email() <> ''
          and lower(coalesce(u.username, '')) = split_part(public.hh_auth_email(), '@', 1)
        )
      )
  )
$$;

create or replace function public.hh_lookup_login(login_input text)
returns table(email text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(u.email, '')) as email, u.username
  from public.hh_users u
  where coalesce(u.is_active, false) = true
    and (
      lower(u.username) = lower(trim(coalesce(login_input, '')))
      or lower(coalesce(u.email, '')) = lower(trim(coalesce(login_input, '')))
    )
  limit 1
$$;

-- Insert admin profile only if missing (never overwrites existing users).
insert into public.hh_users (id, username, email, phone, role, is_active, created)
select 'u1', 'admin', 'admin@hominalhealthcare.com', '9998517492', 'Admin', true, coalesce(to_char(now(), 'DD Mon YYYY'), '')
where not exists (
  select 1 from public.hh_users where lower(coalesce(email, '')) = 'admin@hominalhealthcare.com'
);

revoke execute on function public.hh_lookup_login(text) from public;
grant execute on function public.hh_lookup_login(text) to anon, authenticated;
grant execute on function public.hh_is_active_app_user() to authenticated;
grant execute on function public.hh_auth_email() to authenticated;

-- ── C) Billing RPCs (security definer for receipt writes) ───────────────────
create or replace function public.hominal_replace_service_entries(p_svc_key text, p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer := 0;
begin
  if p_svc_key is null or btrim(p_svc_key) = '' then
    raise exception 'p_svc_key is required';
  end if;
  delete from public.hh_svc_entries where svc_key = p_svc_key;
  insert into public.hh_svc_entries (
    svc_key, billing_id, service_name, partner, date, freq,
    amt, count, disc, total, remarks, partner_id
  )
  select
    p_svc_key,
    coalesce(x.billing_id, ''),
    coalesce(x.service_name, ''),
    coalesce(x.partner, ''),
    coalesce(x.date, ''),
    coalesce(x.freq, ''),
    coalesce(x.amt, 0),
    coalesce(x.count, 1),
    coalesce(x.disc, 0),
    coalesce(x.total, 0),
    coalesce(x.remarks, ''),
    nullif(x.partner_id, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    svc_key text, billing_id text, service_name text, partner text, date text,
    freq text, amt numeric, count numeric, disc numeric, total numeric,
    remarks text, partner_id text
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hominal_replace_payout_charges(p_svc_key text, p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer := 0;
begin
  if p_svc_key is null or btrim(p_svc_key) = '' then
    raise exception 'p_svc_key is required';
  end if;
  delete from public.hh_payout_charges where svc_key = p_svc_key;
  insert into public.hh_payout_charges (svc_key, date, partner, term, amount, remarks)
  select
    p_svc_key,
    coalesce(x.date, ''),
    coalesce(x.partner, ''),
    coalesce(x.term, ''),
    coalesce(x.amount, 0),
    coalesce(x.remarks, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    svc_key text, date text, partner text, term text, amount numeric, remarks text
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hominal_save_receipt(p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hh_receipts%rowtype;
  v_id text := nullif(p_receipt->>'id', '');
  v_billing_id text := nullif(p_receipt->>'billing_id', '');
  v_actor text := coalesce(nullif(p_receipt->>'created_by', ''), auth.email(), 'system');
begin
  if v_id is null then raise exception 'receipt id is required'; end if;
  if v_billing_id is null then raise exception 'billing_id is required'; end if;

  insert into public.hh_receipts (
    id, billing_id, patient_id, service_type, bill_mode,
    from_date, to_date, paid_days, paid_dates,
    date, type, amount, method, ref, remarks,
    deleted_at, created_by, updated_at
  )
  values (
    v_id, v_billing_id,
    coalesce(p_receipt->>'patient_id', ''),
    coalesce(p_receipt->>'service_type', ''),
    coalesce(p_receipt->>'bill_mode', ''),
    coalesce(p_receipt->>'from_date', ''),
    coalesce(p_receipt->>'to_date', ''),
    coalesce(nullif(p_receipt->>'paid_days', ''), '0')::numeric,
    coalesce(p_receipt->'paid_dates', '[]'::jsonb),
    coalesce(p_receipt->>'date', ''),
    coalesce(p_receipt->>'type', ''),
    coalesce(nullif(p_receipt->>'amount', ''), '0')::numeric,
    coalesce(p_receipt->>'method', ''),
    coalesce(p_receipt->>'ref', ''),
    coalesce(p_receipt->>'remarks', ''),
    nullif(p_receipt->>'deleted_at', '')::timestamptz,
    v_actor, now()
  )
  on conflict (id) do update set
    billing_id = excluded.billing_id,
    patient_id = excluded.patient_id,
    service_type = excluded.service_type,
    bill_mode = excluded.bill_mode,
    from_date = excluded.from_date,
    to_date = excluded.to_date,
    paid_days = excluded.paid_days,
    paid_dates = excluded.paid_dates,
    date = excluded.date,
    type = excluded.type,
    amount = excluded.amount,
    method = excluded.method,
    ref = excluded.ref,
    remarks = excluded.remarks,
    deleted_at = excluded.deleted_at,
    created_by = coalesce(public.hh_receipts.created_by, excluded.created_by),
    updated_at = now()
  returning * into v_row;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values ('receipt', v_row.id, 'save', 'Receipt ' || v_row.id || ' saved', to_jsonb(v_row));

  return to_jsonb(v_row);
end;
$$;

create or replace function public.hominal_soft_delete_receipt(
  p_receipt_id text,
  p_billing_id text,
  p_deleted_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hh_receipts%rowtype;
  v_actor text := coalesce(nullif(p_deleted_by, ''), auth.email(), 'system');
begin
  if p_receipt_id is null or btrim(p_receipt_id) = '' then raise exception 'p_receipt_id is required'; end if;
  if p_billing_id is null or btrim(p_billing_id) = '' then raise exception 'p_billing_id is required'; end if;

  update public.hh_receipts
  set deleted_at = coalesce(deleted_at, now()),
      deleted_by = v_actor,
      updated_at = now()
  where id = p_receipt_id and billing_id = p_billing_id
  returning * into v_row;

  if not found then
    raise exception 'receipt % not found for billing %', p_receipt_id, p_billing_id;
  end if;

  insert into public.hh_audit_logs(module, entity_id, action, stamp, payload)
  values ('receipt', v_row.id, 'soft-delete', 'Receipt ' || v_row.id || ' deleted', to_jsonb(v_row));

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.hominal_replace_service_entries(text, jsonb) to authenticated;
grant execute on function public.hominal_replace_payout_charges(text, jsonb) to authenticated;
grant execute on function public.hominal_save_receipt(jsonb) to authenticated;
grant execute on function public.hominal_soft_delete_receipt(text, text, text) to authenticated;

-- ── D) RLS policies ─────────────────────────────────────────────────────────
alter table if exists public.hh_audit_logs enable row level security;
drop policy if exists hh_audit_logs_authenticated_access on public.hh_audit_logs;
create policy hh_audit_logs_authenticated_access on public.hh_audit_logs
  for all to authenticated
  using (public.hh_is_active_app_user())
  with check (public.hh_is_active_app_user());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hh_roles','hh_users','hh_employees','hh_doctors','hh_vendors',
    'hh_patients','hh_inquiries','hh_billings','hh_receipts','hh_svc_entries',
    'hh_payout_charges','hh_paid_transactions','hh_counters','hh_audit_logs','hh_app_settings',
    'hh_invoices','hh_invoice_items','hh_billing_receipts'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_public_access', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_authenticated_access', table_name);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.hh_is_active_app_user()) with check (public.hh_is_active_app_user())',
        table_name || '_authenticated_access', table_name
      );
    end if;
  end loop;
end $$;

-- Realtime (idempotent)
alter table if exists public.hh_billings replica identity full;
alter table if exists public.hh_receipts replica identity full;
alter table if exists public.hh_svc_entries replica identity full;
alter table if exists public.hh_payout_charges replica identity full;
alter table if exists public.hh_paid_transactions replica identity full;

do $$
declare t text;
begin
  foreach t in array array['hh_billings','hh_receipts','hh_svc_entries','hh_payout_charges','hh_paid_transactions']
  loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
