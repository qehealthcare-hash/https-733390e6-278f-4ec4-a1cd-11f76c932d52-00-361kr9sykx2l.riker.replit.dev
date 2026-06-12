-- P2-11: Split blanket FOR ALL `hh_*_authenticated_access` policies on catalog /
-- financial-adjacent tables into explicit SELECT vs role-gated writes.
--
-- Aligns PostgREST RLS with API `requireRole` gates in:
--   doctors/vendors — DIRECTORY_READ + Admin/Manager/Accountant writes, Admin delete
--   hh_roles — registry read + Admin-only catalogue writes
--   hh_svc_entries / hh_paid_transactions — billing read/write role sets
--   hh_counters — active-user read; back-office writes (sequence bumps via API)
--   hh_ai_* — AI route roles; reads only (writes use service-role admin client)

begin;

-- ── Catalog: doctors & vendors ───────────────────────────────────────────────

drop policy if exists hh_doctors_authenticated_access on public.hh_doctors;
drop policy if exists hh_doctors_select on public.hh_doctors;
drop policy if exists hh_doctors_insert on public.hh_doctors;
drop policy if exists hh_doctors_update on public.hh_doctors;
drop policy if exists hh_doctors_delete on public.hh_doctors;

create policy hh_doctors_select on public.hh_doctors
  for select to authenticated
  using (public.hh_is_active_app_user());

create policy hh_doctors_insert on public.hh_doctors
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_doctors_update on public.hh_doctors
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant']))
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_doctors_delete on public.hh_doctors
  for delete to authenticated
  using (public.hh_has_role(array['Admin']));

drop policy if exists hh_vendors_authenticated_access on public.hh_vendors;
drop policy if exists hh_vendors_select on public.hh_vendors;
drop policy if exists hh_vendors_insert on public.hh_vendors;
drop policy if exists hh_vendors_update on public.hh_vendors;
drop policy if exists hh_vendors_delete on public.hh_vendors;

create policy hh_vendors_select on public.hh_vendors
  for select to authenticated
  using (public.hh_is_active_app_user());

create policy hh_vendors_insert on public.hh_vendors
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_vendors_update on public.hh_vendors
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant']))
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_vendors_delete on public.hh_vendors
  for delete to authenticated
  using (public.hh_has_role(array['Admin']));

-- ── Role catalogue (lookups + admin UI) ───────────────────────────────────────

drop policy if exists hh_roles_authenticated_access on public.hh_roles;
drop policy if exists hh_roles_select on public.hh_roles;
drop policy if exists hh_roles_insert on public.hh_roles;
drop policy if exists hh_roles_update on public.hh_roles;
drop policy if exists hh_roles_delete on public.hh_roles;

create policy hh_roles_select on public.hh_roles
  for select to authenticated
  using (public.hh_is_active_app_user());

create policy hh_roles_insert on public.hh_roles
  for insert to authenticated
  with check (public.hh_has_role(array['Admin']));

create policy hh_roles_update on public.hh_roles
  for update to authenticated
  using (public.hh_has_role(array['Admin']))
  with check (public.hh_has_role(array['Admin']));

create policy hh_roles_delete on public.hh_roles
  for delete to authenticated
  using (public.hh_has_role(array['Admin']));

-- ── Financial ledger satellites (back-office read) ───────────────────────────

drop policy if exists hh_paid_transactions_authenticated_access on public.hh_paid_transactions;
drop policy if exists hh_paid_transactions_select on public.hh_paid_transactions;
drop policy if exists hh_paid_transactions_insert on public.hh_paid_transactions;
drop policy if exists hh_paid_transactions_update on public.hh_paid_transactions;
drop policy if exists hh_paid_transactions_delete on public.hh_paid_transactions;

create policy hh_paid_transactions_select on public.hh_paid_transactions
  for select to authenticated
  using (
    public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff', 'Supervisor'])
  );

create policy hh_paid_transactions_insert on public.hh_paid_transactions
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

create policy hh_paid_transactions_update on public.hh_paid_transactions
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']))
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

create policy hh_paid_transactions_delete on public.hh_paid_transactions
  for delete to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

drop policy if exists hh_svc_entries_authenticated_access on public.hh_svc_entries;
drop policy if exists hh_svc_entries_select on public.hh_svc_entries;
drop policy if exists hh_svc_entries_insert on public.hh_svc_entries;
drop policy if exists hh_svc_entries_update on public.hh_svc_entries;
drop policy if exists hh_svc_entries_delete on public.hh_svc_entries;

create policy hh_svc_entries_select on public.hh_svc_entries
  for select to authenticated
  using (
    public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff', 'Supervisor'])
  );

create policy hh_svc_entries_insert on public.hh_svc_entries
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

create policy hh_svc_entries_update on public.hh_svc_entries
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']))
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

create policy hh_svc_entries_delete on public.hh_svc_entries
  for delete to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

-- ── ID counters (internal sequence table) ────────────────────────────────────

drop policy if exists hh_counters_authenticated_access on public.hh_counters;
drop policy if exists hh_counters_select on public.hh_counters;
drop policy if exists hh_counters_insert on public.hh_counters;
drop policy if exists hh_counters_update on public.hh_counters;
drop policy if exists hh_counters_delete on public.hh_counters;

create policy hh_counters_select on public.hh_counters
  for select to authenticated
  using (public.hh_is_active_app_user());

create policy hh_counters_insert on public.hh_counters
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_counters_update on public.hh_counters
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant']))
  with check (public.hh_has_role(array['Admin', 'Manager', 'Accountant']));

create policy hh_counters_delete on public.hh_counters
  for delete to authenticated
  using (public.hh_has_role(array['Admin']));

-- ── AI assistant logs (reads only for authenticated — writes via service_role) ─

drop policy if exists hh_ai_conversations_authenticated_access on public.hh_ai_conversations;
drop policy if exists hh_ai_conversations_select on public.hh_ai_conversations;
drop policy if exists hh_ai_conversations_insert on public.hh_ai_conversations;
drop policy if exists hh_ai_conversations_update on public.hh_ai_conversations;
drop policy if exists hh_ai_conversations_delete on public.hh_ai_conversations;

create policy hh_ai_conversations_select on public.hh_ai_conversations
  for select to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

drop policy if exists hh_ai_messages_authenticated_access on public.hh_ai_messages;
drop policy if exists hh_ai_messages_select on public.hh_ai_messages;
drop policy if exists hh_ai_messages_insert on public.hh_ai_messages;
drop policy if exists hh_ai_messages_update on public.hh_ai_messages;
drop policy if exists hh_ai_messages_delete on public.hh_ai_messages;

create policy hh_ai_messages_select on public.hh_ai_messages
  for select to authenticated
  using (public.hh_has_role(array['Admin', 'Manager', 'Accountant', 'Staff']));

-- ── Audit probe (P2-11) ──────────────────────────────────────────────────────

create or replace function public.audit_probe_p2_11_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  with targets as (
    select unnest(array[
      'hh_doctors', 'hh_vendors', 'hh_roles', 'hh_paid_transactions',
      'hh_counters', 'hh_svc_entries', 'hh_ai_conversations', 'hh_ai_messages'
    ]::text[]) as tablename
  ),
  blanket as (
    select 1
      from pg_policies p
      join targets t on t.tablename = p.tablename
     where p.schemaname = 'public'
       and 'authenticated' = any (p.roles)
       and p.cmd = 'ALL'
       and coalesce(p.qual, '') ~ 'hh_is_active_app_user'
  ),
  required as (
    select t.tablename,
      exists (
        select 1 from pg_policies p
         where p.schemaname = 'public'
           and p.tablename = t.tablename
           and p.cmd = 'SELECT'
           and 'authenticated' = any (p.roles)
      ) as has_select,
      exists (
        select 1 from pg_policies p
         where p.schemaname = 'public'
           and p.tablename = t.tablename
           and p.cmd = 'INSERT'
           and coalesce(p.with_check, '') ~ 'hh_has_role'
      ) as has_role_insert
    from targets t
    where t.tablename not in ('hh_ai_conversations', 'hh_ai_messages')
  )
  select not exists (select 1 from blanket)
     and not exists (
       select 1 from required where not has_select or not has_role_insert
     )
     and exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'hh_ai_conversations'
          and cmd = 'SELECT' and 'authenticated' = any (roles)
     )
     and exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'hh_ai_messages'
          and cmd = 'SELECT' and 'authenticated' = any (roles)
     )
     and not exists (
       select 1 from pg_policies p
        join targets t on t.tablename = p.tablename
       where p.schemaname = 'public'
         and 'authenticated' = any (p.roles)
         and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
         and t.tablename in ('hh_ai_conversations', 'hh_ai_messages')
     );
$$;

revoke all on function public.audit_probe_p2_11_ok() from public;
grant execute on function public.audit_probe_p2_11_ok() to service_role;

commit;
