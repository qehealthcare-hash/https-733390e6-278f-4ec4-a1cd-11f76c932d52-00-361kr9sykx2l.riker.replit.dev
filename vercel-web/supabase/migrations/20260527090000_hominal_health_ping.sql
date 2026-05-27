-- Lightweight health probe RPC for /api/v1/health (service_role only).

create or replace function public.hominal_health_ping()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'ts', now());
$$;

revoke all on function public.hominal_health_ping() from public, anon, authenticated;
grant execute on function public.hominal_health_ping() to service_role;
