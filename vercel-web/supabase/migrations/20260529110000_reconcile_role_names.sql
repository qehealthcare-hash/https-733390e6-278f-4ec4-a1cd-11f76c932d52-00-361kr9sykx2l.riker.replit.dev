-- =============================================================================
-- M2-C2: Reconcile `hh_roles.name` with the role labels the API expects.
--
-- Background:
--   `lib/api/auth.ts:requireRole` compares the actor's role string against
--   literals like "Admin", "Manager", "Staff", "Accountant". The
--   `hh_roles` table — used by the "Users & Roles" admin UI to populate
--   the role dropdown when creating a user — drifted to:
--
--     id  | name        | API recognised?
--     ----+-------------+----------------
--     r1  | Admin       | yes
--     r2  | Account     | NO  -> typo; should be Accountant
--     r3  | Executive   | yes
--     r4  | Doctor      | no  -> zero references in code, 0 users assigned
--     r5  | Nurse       | yes
--     r6  | Attendant   | no  -> zero references in code, 0 users assigned
--     r7  | Supervisor  | yes
--
--   Plus: "Manager" and "Staff" — both referenced extensively by the API
--   (e.g. `requireRole(actor, ["Admin","Manager"])`) — had NO rows in
--   hh_roles, so admins couldn't create users with those roles via the UI.
--
-- After this migration, hh_roles holds exactly:
--   Admin, Accountant, Executive, Manager, Nurse, Staff, Supervisor
--
-- Preflight (verified at audit time):
--   * 0 production users assigned to "Account", "Doctor" or "Attendant".
--   * Every required label that survives (Admin, Accountant, Executive,
--     Manager, Nurse, Staff, Supervisor) corresponds to at least one
--     `requireRole(actor, [...])` literal in app/api/v1/*.
--
-- Safety:
--   * The migration aborts loudly if it would orphan any user (raises
--     EXCEPTION P0001 with the offending count).
--   * Renames are pure-text and reversible.
--   * Inserts use ON CONFLICT DO NOTHING so re-running is a no-op.
--
-- Rollback:
--   See `20260529110000_reconcile_role_names_rollback.sql` (sibling).
-- =============================================================================

begin;

-- 1. Refuse to run if any user is assigned to a role we're about to delete
--    or rename — production has none, but a freshly seeded staging env
--    might.
do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
    from public.hh_users
   where role in ('Doctor', 'Attendant');
  if v_orphans > 0 then
    raise exception
      'Refusing to drop roles Doctor/Attendant: % user(s) still assigned. Reassign them first.',
      v_orphans
      using errcode = 'P0001';
  end if;
end$$;

-- 2. Rename "Account" -> "Accountant" so users created with the typo'd
--    role label still map to the API-recognized name.
update public.hh_users
   set role = 'Accountant'
 where role = 'Account';

update public.hh_roles
   set name       = 'Accountant',
       updated_at = now()
 where name = 'Account';

-- 3. Drop unreferenced legacy roles. Both Doctor and Attendant are no
--    longer assigned to any user (assertion above) and have zero code
--    references; keeping them invites admins to assign them and then
--    silently fall back to Staff-equivalent perms.
delete from public.hh_roles
 where name in ('Doctor', 'Attendant');

-- 4. Insert canonical labels the API expects but the DB never had. The
--    `perms` column is set to '{}' deliberately — Module 2 confirmed
--    the DB perm matrix is not consulted by the runtime; the column
--    stays for forward-compatibility / audit reference only.
--
--    `id` follows the existing r1..r7 pattern; pick the next two
--    unused slots deterministically rather than hashing a uuid in
--    so the rollback SQL can target them by id.
insert into public.hh_roles (id, name, perms, created_at, updated_at)
values
  ('r8', 'Manager', '{}'::jsonb, now(), now()),
  ('r9', 'Staff',   '{}'::jsonb, now(), now())
on conflict (id) do nothing;

-- 5. Final assertion: the surviving role catalogue matches exactly the
--    seven canonical labels. Any extra rows means someone seeded a
--    custom role we don't expect — fail loudly so the operator notices.
do $$
declare
  v_unexpected text;
begin
  select string_agg(name, ', ') into v_unexpected
    from public.hh_roles
   where name not in (
     'Admin', 'Accountant', 'Executive', 'Manager',
     'Nurse', 'Staff', 'Supervisor'
   );
  if v_unexpected is not null then
    raise exception
      'Unexpected role(s) remain in hh_roles after reconciliation: %. Investigate.',
      v_unexpected
      using errcode = 'P0001';
  end if;
end$$;

commit;
