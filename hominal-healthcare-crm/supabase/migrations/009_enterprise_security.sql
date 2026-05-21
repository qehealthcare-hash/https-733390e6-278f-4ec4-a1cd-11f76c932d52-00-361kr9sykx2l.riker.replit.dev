-- Enterprise security: actor resolution, login RPC lockdown, ledger RLS

begin;

create or replace function public.resolve_rpc_actor(p_actor_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_actor_user_id,
    (select id from public.app_users where auth_user_id = auth.uid() and deleted_at is null limit 1)
  );
$$;

revoke all on function public.resolve_rpc_actor(uuid) from public;
grant execute on function public.resolve_rpc_actor(uuid) to authenticated, service_role;

-- Monorepo login uses app_users; legacy hh_lookup_login should not be callable anonymously.
do $$
begin
  if to_regprocedure('public.hh_lookup_login(text)') is not null then
    revoke execute on function public.hh_lookup_login(text) from anon;
    grant execute on function public.hh_lookup_login(text) to authenticated;
  end if;
end
$$;

do $$
declare
  ledger_table text;
begin
  foreach ledger_table in array array[
    'patient_services',
    'billing_receipts',
    'staff_payouts'
  ]
  loop
    if to_regclass('public.' || ledger_table) is not null then
      execute format('alter table public.%I enable row level security', ledger_table);
    end if;
  end loop;
end
$$;

commit;
