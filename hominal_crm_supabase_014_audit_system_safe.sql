-- Phase 14 — Audit log system (SAFE / ADDITIVE ONLY)
-- Do NOT drop tables, truncate, or alter primary-key types.
-- Apply in Supabase SQL editor AFTER 011, 012, and 013 when present.
-- Idempotent: safe to re-run.
--
-- ── Inspect before applying ───────────────────────────────────────────────
--   SELECT EXISTS (
--     SELECT 1 FROM information_schema.tables
--     WHERE table_schema = 'public' AND table_name = 'hh_audit_logs'
--   ) AS audit_table_exists;
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'hh_audit_logs'
--   ORDER BY ordinal_position;

begin;

-- Canonical shape used by vercel-web `auditRepository` (module / before / after).
create table if not exists public.hh_audit_logs (
  id bigserial primary key,
  module text not null default 'unknown',
  entity_id text,
  action text not null default '',
  stamp text,
  actor text,
  user_id text,
  before jsonb,
  after jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Upgrade legacy CRM tables (text id, entity_type, actor_user_id, …) without data loss.
alter table if exists public.hh_audit_logs
  add column if not exists module text,
  add column if not exists entity_id text,
  add column if not exists action text,
  add column if not exists stamp text,
  add column if not exists actor text,
  add column if not exists user_id text,
  add column if not exists before jsonb,
  add column if not exists after jsonb,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

-- Backfill module/entity_id from legacy columns when present (no-op if already set).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hh_audit_logs' and column_name = 'entity_type'
  ) then
    execute $sql$
      update public.hh_audit_logs
      set module = coalesce(nullif(module, ''), nullif(entity_type, ''), 'legacy'),
          entity_id = coalesce(nullif(entity_id, ''), nullif(entity_id, ''), '')
      where coalesce(module, '') = '' and coalesce(entity_type, '') <> ''
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hh_audit_logs' and column_name = 'actor_user_id'
  ) then
    execute $sql$
      update public.hh_audit_logs
      set user_id = coalesce(nullif(user_id, ''), nullif(actor_user_id, ''))
      where coalesce(user_id, '') = '' and coalesce(actor_user_id, '') <> ''
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hh_audit_logs' and column_name = 'actor_username'
  ) then
    execute $sql$
      update public.hh_audit_logs
      set actor = coalesce(nullif(actor, ''), nullif(actor_username, ''))
      where coalesce(actor, '') = '' and coalesce(actor_username, '') <> ''
    $sql$;
  end if;
end $$;

create index if not exists idx_hh_audit_logs_module_created
  on public.hh_audit_logs (module, created_at desc);

create index if not exists idx_hh_audit_logs_entity
  on public.hh_audit_logs (entity_id);

create index if not exists idx_hh_audit_logs_user_id
  on public.hh_audit_logs (user_id)
  where user_id is not null;

alter table if exists public.hh_audit_logs enable row level security;

drop policy if exists hh_audit_logs_select_authenticated on public.hh_audit_logs;
create policy hh_audit_logs_select_authenticated on public.hh_audit_logs
  for select to authenticated
  using (true);

drop policy if exists hh_audit_logs_insert_authenticated on public.hh_audit_logs;
create policy hh_audit_logs_insert_authenticated on public.hh_audit_logs
  for insert to authenticated
  with check (true);

grant select, insert on public.hh_audit_logs to authenticated;

do $$
begin
  if to_regclass('public.hh_audit_logs_id_seq') is not null then
    grant usage, select on sequence public.hh_audit_logs_id_seq to authenticated;
  end if;
end $$;

commit;

-- Post-check:
--   SELECT module, action, entity_id, user_id, actor, created_at
--   FROM public.hh_audit_logs ORDER BY created_at DESC LIMIT 5;
