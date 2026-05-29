-- =============================================================================
-- M1-H2: Drop the dead `hh_users.password` column.
--
-- Why:
--   Authentication moved to Supabase Auth (GoTrue) long ago. The legacy
--   `password` column on `public.hh_users` is no longer read or written by
--   any code path in this repository (verified via grep) and `select count(*)
--   from hh_users where password is not null and password <> ''` returned 0
--   on production at audit time. Leaving the column in place is a footgun:
--   any future "helpful" code that writes a password here would create a
--   parallel, unhashed credential store completely outside Supabase Auth.
--
-- Safety:
--   * Pre-deploy check should re-verify the column is empty (see assertion
--     below). The migration aborts via DO $$ if any populated row is found.
--   * A companion rollback migration adds the column back as nullable. No
--     data is preserved by the rollback because the source rows had no
--     content at drop time — this is a schema-only DROP, not a destructive
--     data migration.
--
-- Rollback:
--   `alter table public.hh_users add column if not exists password text;`
-- =============================================================================

begin;

-- Hard assertion: refuse to drop the column if anyone has been writing to
-- it since the audit. Production-state at write time was 0 populated rows;
-- if that has changed between audit and deploy we want a loud failure so
-- we can investigate (some new code likely sneaked a write in).
do $$
declare
  v_populated bigint;
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'hh_users'
       and column_name  = 'password'
  ) then
    select count(*) into v_populated
      from public.hh_users
     where password is not null
       and btrim(password) <> '';

    if v_populated > 0 then
      raise exception
        'Refusing to drop hh_users.password: % populated row(s) found. Investigate before re-applying.',
        v_populated
        using errcode = 'P0001';
    end if;
  end if;
end$$;

alter table public.hh_users drop column if exists password;

commit;
