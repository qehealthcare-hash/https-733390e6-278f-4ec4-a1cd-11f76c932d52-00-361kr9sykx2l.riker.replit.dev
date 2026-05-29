-- =============================================================================
-- M2-C2 rollback for `20260529110000_reconcile_role_names.sql`.
--
-- Reverses the role-catalogue reconciliation:
--   * Removes the synthetic Manager / Staff rows (only if no users
--     have been assigned to them in the interim).
--   * Re-creates the dropped Doctor and Attendant rows with empty perms.
--   * Renames Accountant back to Account.
--
-- This rollback is intentionally not auto-applied. If the forward
-- migration is causing problems, run this file explicitly and verify.
-- =============================================================================

begin;

do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
    from public.hh_users
   where role in ('Manager', 'Staff');
  if v_orphans > 0 then
    raise exception
      'Refusing to drop Manager/Staff rows: % user(s) still assigned. Reassign before rolling back.',
      v_orphans
      using errcode = 'P0001';
  end if;
end$$;

delete from public.hh_roles where name in ('Manager', 'Staff');

insert into public.hh_roles (id, name, perms, created_at, updated_at)
values
  ('r4', 'Doctor',    '{"patients":["view"]}'::jsonb, now(), now()),
  ('r6', 'Attendant', '{"patients":["view"],"services":["view"]}'::jsonb, now(), now())
on conflict (id) do nothing;

update public.hh_users
   set role = 'Account'
 where role = 'Accountant';

update public.hh_roles
   set name       = 'Account',
       updated_at = now()
 where name = 'Accountant';

commit;
