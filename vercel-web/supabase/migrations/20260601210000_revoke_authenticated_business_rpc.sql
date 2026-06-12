-- R2: Revoke EXECUTE on SECURITY DEFINER business RPCs from `authenticated`.
--
-- Direct PostgREST calls (`/rest/v1/rpc/hominal_*` with a user JWT) must not
-- bypass the Next.js route layer. CRM API handlers call the same RPCs through
-- the service role while forwarding the user JWT in Authorization so
-- `auth.jwt()` / `hh_has_role()` inside function bodies still enforce roles.
--
-- Keep EXECUTE on RLS helper functions for `authenticated`:
--   hh_is_active_app_user, hh_has_role, hh_current_role, hh_current_actor, …

begin;

-- Audit probes: service_role + CI only (never browser JWT).
revoke execute on function public.audit_probe_p1_4_ok() from authenticated;
revoke execute on function public.audit_probe_p1_11_ok() from authenticated;
revoke execute on function public.audit_probe_p1_12_ok() from authenticated;
revoke execute on function public.audit_probe_p1_13_ok() from authenticated;
revoke execute on function public.audit_probe_p1_14_ok() from authenticated;

grant execute on function public.audit_probe_p1_4_ok() to service_role;
grant execute on function public.audit_probe_p1_11_ok() to service_role;
grant execute on function public.audit_probe_p1_12_ok() to service_role;
grant execute on function public.audit_probe_p1_13_ok() to service_role;
grant execute on function public.audit_probe_p1_14_ok() to service_role;

-- Internal role-guard helper (only invoked from other SECURITY DEFINER bodies).
revoke execute on function public._hh_require_role(text[]) from authenticated;

-- All other business / ledger RPCs: revoke from authenticated, grant service_role.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (
        p.proname like 'hominal\_%'
        or p.proname like 'audit\_probe\_%'
        or p.proname like 'hh\_duty\_days\_%'
        or p.proname in (
          'hh_recompute_payout',
          'hh_convert_inquiry_to_patient',
          'hh_compact_invoice_seq',
          'hh_next_invoice_no',
          'hh_next_receipt_no',
          'hh_next_paid_tx_serial',
          'hh_employee_pending_payout',
          'hh_employees_pending_for_period',
          'hominal_health_ping'
        )
      )
      and p.proname not in (
        'hh_lookup_login',
        '_hh_resolve_login_email',
        'hh_is_active_app_user',
        'hh_has_role',
        'hh_current_role',
        'hh_current_actor',
        'hh_current_app_user'
      )
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- R5: hh_idempotency is server-only (service role bypasses RLS; block authenticated).
drop policy if exists hh_idempotency_service on public.hh_idempotency;
create policy hh_idempotency_service on public.hh_idempotency
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.hh_idempotency from authenticated;

commit;
