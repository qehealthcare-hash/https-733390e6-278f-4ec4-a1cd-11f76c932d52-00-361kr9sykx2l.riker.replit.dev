-- Fix: the Phase-4 duty-ledger protection trigger (20260613100000) blocked the
-- application's own materializer. The server materializer writes per-day rows
-- via PostgREST as the `service_role`, but the trigger only permitted writes
-- when the transaction-local flag `hominal.duty_ledger_write` was set — a flag
-- that only the two SQL RPCs set, never the app's multi-statement PostgREST
-- path. Result: every duty materialization failed with
--   "Duty-calendar ledger rows can only be created by the Duty Calendar
--    materializer. Edit the duty in the Duty Calendar instead."
--
-- Correct rule: the trusted server service layer (service_role, which the
-- browser never holds) may write duty-materialized rows; frontend roles
-- (`authenticated` / `anon`) still cannot write them directly. This keeps
-- "Frontend NEVER directly updates database" intact while unblocking the
-- materializer.

begin;

-- NOTE: SECURITY INVOKER (not DEFINER). The trigger only inspects NEW/OLD and
-- raises — it needs no elevated privileges — and INVOKER is required so
-- `current_user` reflects the *caller's* PostgREST role (service_role vs
-- authenticated). Under SECURITY DEFINER, current_user would always be the
-- function owner (postgres), defeating the role check.
create or replace function public.hh_protect_duty_ledger_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_duty boolean := coalesce(old.remarks, '') like 'duty:%';
  v_new_duty boolean := coalesce(new.remarks, '') like 'duty:%';
  v_flag boolean := coalesce(current_setting('hominal.duty_ledger_write', true), '') = '1';
  -- The server service layer talks to PostgREST with the service-role key, so
  -- the caller role resolves to 'service_role' (via SET ROLE and/or JWT claims).
  v_service boolean := (
    current_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role'
  );
  v_allowed boolean := v_flag or v_service;
begin
  if tg_op = 'INSERT' then
    if v_new_duty and not v_allowed then
      raise exception
        'Duty-calendar ledger rows can only be created by the Duty Calendar materializer. Edit the duty in the Duty Calendar instead.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (v_old_duty or v_new_duty) and not v_allowed then
      raise exception
        'Duty-calendar ledger rows are read-only. Edit the duty in the Duty Calendar instead.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_old_duty and not v_allowed then
      raise exception
        'Duty-calendar ledger rows cannot be deleted here. Cancel or edit the duty in the Duty Calendar instead.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

commit;
