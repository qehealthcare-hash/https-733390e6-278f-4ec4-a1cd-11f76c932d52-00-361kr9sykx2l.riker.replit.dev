-- =============================================================================
-- Migration 045 — Corporate audit Phase 8 (API security hygiene)
--
-- 1. Ensure hh_idempotency exists for POST dedupe (API layer)
-- 2. Document: legacy sync must use Admin/Manager JWT only (enforced in routes)
-- =============================================================================

begin;

create table if not exists public.hh_idempotency (
  key text not null,
  actor text not null,
  route text not null,
  response jsonb,
  status integer not null default 200,
  created_at timestamptz not null default now(),
  primary key (key, actor)
);

create index if not exists idx_hh_idempotency_created_at on public.hh_idempotency (created_at);

alter table public.hh_idempotency enable row level security;

drop policy if exists hh_idempotency_service on public.hh_idempotency;
create policy hh_idempotency_service on public.hh_idempotency
  for all
  using (false)
  with check (false);

comment on table public.hh_idempotency is
  'Server-only idempotency cache for POST /api/v1/* (service role bypasses RLS).';

commit;
