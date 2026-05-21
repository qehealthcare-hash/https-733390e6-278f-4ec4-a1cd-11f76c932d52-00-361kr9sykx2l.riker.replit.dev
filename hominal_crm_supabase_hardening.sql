begin;

update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where lower(email) = 'admin@hominalhealthcare.in';

alter table public.hh_users add column if not exists password text;
alter table public.hh_users alter column password drop default;
update public.hh_users set email = lower(coalesce(email, ''));
update public.hh_users set password = null where password is not null;

grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

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
    where lower(coalesce(u.email, '')) = public.hh_auth_email()
      and coalesce(u.is_active, false) = true
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

create or replace function public.hh_current_app_user()
returns table(
  id text,
  username text,
  email text,
  phone text,
  role text,
  is_active boolean,
  created text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.username,
    lower(coalesce(u.email, '')) as email,
    u.phone,
    u.role,
    u.is_active,
    u.created
  from public.hh_users u
  where lower(coalesce(u.email, '')) = public.hh_auth_email()
    and coalesce(u.is_active, false) = true
  limit 1
$$;

grant execute on function public.hh_lookup_login(text) to anon, authenticated;
grant execute on function public.hh_current_app_user() to authenticated;
grant execute on function public.hh_is_active_app_user() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hh_roles',
    'hh_users',
    'hh_employees',
    'hh_doctors',
    'hh_vendors',
    'hh_patients',
    'hh_inquiries',
    'hh_billings',
    'hh_receipts',
    'hh_svc_entries',
    'hh_payout_charges',
    'hh_paid_transactions',
    'hh_counters',
    'hh_audit_logs',
    'hh_app_settings'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'drop policy if exists %I on public.%I',
        table_name || '_public_access',
        table_name
      );
      execute format(
        'drop policy if exists %I on public.%I',
        table_name || '_authenticated_access',
        table_name
      );
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.hh_is_active_app_user()) with check (public.hh_is_active_app_user())',
        table_name || '_authenticated_access',
        table_name
      );
    end if;
  end loop;
end
$$;

commit;
