-- P1-14: hh_lookup_login returns a single boolean and EXECUTE is revoked from
-- `authenticated`. The previous TABLE(email, username) variant let any signed-in
-- user enumerate the entire workforce by hammering /rest/v1/rpc/hh_lookup_login
-- with candidate strings. The new variant returns only "is there an account
-- matching this login?", and EXECUTE is held by service_role / postgres so the
-- only legitimate caller is the server-side /api/v1/auth/login proxy that
-- arrives in P1-38.
--
-- Username → email translation for the legacy iframe / server proxy moves to a
-- separate internal helper `_hh_resolve_login_email(text)` that is also
-- restricted to service_role.

set search_path = public, pg_temp;

drop function if exists public.hh_lookup_login(text);

create or replace function public.hh_lookup_login(login_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.hh_users u
     where coalesce(u.is_active, false) = true
       and (
         lower(u.username) = lower(trim(coalesce(login_input, '')))
         or lower(coalesce(u.email, '')) = lower(trim(coalesce(login_input, '')))
       )
  );
$$;

revoke all on function public.hh_lookup_login(text) from public, anon, authenticated;
grant execute on function public.hh_lookup_login(text) to service_role;

-- Internal: used by the server-side login proxy (P1-38) to translate a
-- username into the matching email so Supabase Auth can sign the user in.
create or replace function public._hh_resolve_login_email(login_input text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(u.email, ''))
    from public.hh_users u
   where coalesce(u.is_active, false) = true
     and (
       lower(u.username) = lower(trim(coalesce(login_input, '')))
       or lower(coalesce(u.email, '')) = lower(trim(coalesce(login_input, '')))
     )
   limit 1;
$$;

revoke all on function public._hh_resolve_login_email(text) from public, anon, authenticated;
grant execute on function public._hh_resolve_login_email(text) to service_role;
