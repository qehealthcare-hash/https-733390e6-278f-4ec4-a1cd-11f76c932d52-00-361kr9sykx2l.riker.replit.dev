-- Read-only audit probe RPCs (boolean pass/fail). Used by tests/audit_checks SQL probes
-- without requiring SUPABASE_SERVICE_ROLE_KEY or /pg/query access.

create or replace function public.audit_probe_p1_4_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name
       and kcu.constraint_schema = rc.constraint_schema
     where rc.constraint_schema = 'public'
       and (
         (kcu.table_name in ('hh_receipts','hh_invoices','hh_svc_entries') and kcu.column_name = 'billing_id')
         or (kcu.table_name = 'hh_attendance' and kcu.column_name = 'duty_id')
       )
       and rc.delete_rule <> 'RESTRICT'
  );
$$;

create or replace function public.audit_probe_p1_11_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0
          or position('for update' in lower(pg_get_functiondef(p.oid))) > 0
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hh_recompute_payout'
    ),
    false
  );
$$;

create or replace function public.audit_probe_p1_12_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0
          and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
          and position('gen_random_uuid' in pg_get_functiondef(p.oid)) > 0
          and position('random()' in pg_get_functiondef(p.oid)) = 0
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hh_convert_inquiry_to_patient'
    ),
    false
  );
$$;

create or replace function public.audit_probe_p1_13_ok()
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('hh_billings','hh_payouts')
       and c.column_name = 'status'
       and c.is_nullable <> 'NO'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_billings'
       and con.contype = 'c' and con.conname = 'chk_hh_billings_status'
  )
  and exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public' and cl.relname = 'hh_payouts'
       and con.contype = 'c' and con.conname = 'chk_hh_payouts_status'
  );
$$;

revoke all on function public.audit_probe_p1_4_ok() from public;
revoke all on function public.audit_probe_p1_11_ok() from public;
revoke all on function public.audit_probe_p1_12_ok() from public;
revoke all on function public.audit_probe_p1_13_ok() from public;
grant execute on function public.audit_probe_p1_4_ok() to anon, authenticated, service_role;
grant execute on function public.audit_probe_p1_11_ok() to anon, authenticated, service_role;
grant execute on function public.audit_probe_p1_12_ok() to anon, authenticated, service_role;
grant execute on function public.audit_probe_p1_13_ok() to anon, authenticated, service_role;
