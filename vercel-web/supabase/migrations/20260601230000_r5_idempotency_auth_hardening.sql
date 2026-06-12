-- R5 (B5): Lock down hh_idempotency — server_role only (no authenticated / public access).
--
-- Complements 20260601210000_revoke_authenticated_business_rpc.sql (idempotent).
-- Drops legacy hh_idempotency_authenticated_access from early schema dumps.

begin;

drop policy if exists hh_idempotency_authenticated_access on public.hh_idempotency;
drop policy if exists hh_idempotency_service on public.hh_idempotency;

create policy hh_idempotency_service on public.hh_idempotency
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.hh_idempotency from public;
revoke all on table public.hh_idempotency from anon;
revoke all on table public.hh_idempotency from authenticated;

grant select, insert, update, delete on table public.hh_idempotency to service_role;

comment on table public.hh_idempotency is
  'Server-only idempotency cache for POST /api/v1/* (service_role grants + RLS; never expose to PostgREST clients).';

commit;
