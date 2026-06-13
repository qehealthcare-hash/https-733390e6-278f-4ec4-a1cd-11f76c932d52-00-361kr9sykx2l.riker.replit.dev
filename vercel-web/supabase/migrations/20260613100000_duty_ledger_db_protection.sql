-- Phase 4: Duty Calendar ledger protection at the database layer.
--
-- 1. Audit triggers on billing/payout ledger tables (hh_svc_entries,
--    hh_payout_charges, hh_receipts).
-- 2. Block direct UPDATE/DELETE of duty-materialized rows (remarks `duty:%`)
--    unless the session flag hominal.duty_ledger_write=1 (set by materializer
--    RPCs patched below).
-- 3. Prevent duplicate active duty assignments (business rule #8).

begin;

-- ── Session flag helpers (materializer RPCs enable writes for one txn) ───────

create or replace function public.hominal_set_duty_ledger_write(p_on boolean default true)
returns void
language plpgsql
security invoker
as $$
begin
  perform set_config(
    'hominal.duty_ledger_write',
    case when coalesce(p_on, true) then '1' else '0' end,
    true
  );
end;
$$;

comment on function public.hominal_set_duty_ledger_write(boolean) is
  'Enable/disable duty-calendar ledger row writes for the current transaction.';

-- Patch materializer + repair RPCs to set the flag at entry.
do $patch$
declare
  v_def text;
  v_names text[] := array[
    'hominal_materialize_due_duty_days',
    'hominal_repair_duty_ledger_window'
  ];
  v_name text;
begin
  foreach v_name in array v_names
  loop
    select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name
    order by p.oid
    limit 1;

    if v_def is null then
      raise notice 'skip patch: function % not found', v_name;
      continue;
    end if;

    if v_def like '%hominal.duty_ledger_write%' then
      raise notice 'skip patch: % already sets duty_ledger_write', v_name;
      continue;
    end if;

    v_def := replace(
      v_def,
      E'begin\n  if v_to',
      E'begin\n  perform set_config(''hominal.duty_ledger_write'', ''1'', true);\n  if v_to'
    );

    if v_def not like '%hominal.duty_ledger_write%' then
      v_def := replace(
        v_def,
        E'begin\n',
        E'begin\n  perform set_config(''hominal.duty_ledger_write'', ''1'', true);\n',
        1
      );
    end if;

    execute v_def;
    raise notice 'patched % to set hominal.duty_ledger_write', v_name;
  end loop;
end;
$patch$;

-- ── Protect duty-materialized ledger rows ────────────────────────────────────

create or replace function public.hh_protect_duty_ledger_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_duty boolean := coalesce(old.remarks, '') like 'duty:%';
  v_new_duty boolean := coalesce(new.remarks, '') like 'duty:%';
  v_allowed boolean := coalesce(current_setting('hominal.duty_ledger_write', true), '') = '1';
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

drop trigger if exists trg_protect_duty_svc_entries on public.hh_svc_entries;
create trigger trg_protect_duty_svc_entries
  before insert or update or delete on public.hh_svc_entries
  for each row execute function public.hh_protect_duty_ledger_row();

drop trigger if exists trg_protect_duty_payout_charges on public.hh_payout_charges;
create trigger trg_protect_duty_payout_charges
  before insert or update or delete on public.hh_payout_charges
  for each row execute function public.hh_protect_duty_ledger_row();

-- ── Audit triggers on ledger tables ──────────────────────────────────────────

do $$
declare
  cfg record;
begin
  for cfg in
    select * from (values
      ('hh_svc_entries', 'billing_svc'),
      ('hh_payout_charges', 'payout_charge'),
      ('hh_receipts', 'billing_receipt')
    ) as v(table_name, module_name)
  loop
    if to_regclass('public.' || cfg.table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists created_by text',
        cfg.table_name
      );
      execute format(
        'alter table public.%I add column if not exists updated_by text',
        cfg.table_name
      );
      execute format(
        'alter table public.%I add column if not exists created_at timestamptz default now()',
        cfg.table_name
      );
      execute format(
        'alter table public.%I add column if not exists updated_at timestamptz default now()',
        cfg.table_name
      );
      execute format(
        'drop trigger if exists %I on public.%I',
        'trg_audit_' || cfg.table_name,
        cfg.table_name
      );
      execute format(
        'create trigger %I before insert or update or delete on public.%I '
        || 'for each row execute function public.hh_audit_trigger(%L)',
        'trg_audit_' || cfg.table_name,
        cfg.table_name,
        cfg.module_name
      );
    end if;
  end loop;
end $$;

-- ── No duplicate active duty rows (rule #8) ──────────────────────────────────

create unique index if not exists uq_hh_duties_active_assignment
  on public.hh_duties (
    patient_id,
    employee_id,
    start_at,
    end_at,
    coalesce(shift_type, ''),
    coalesce(service_type, '')
  )
  where deleted_at is null
    and upper(coalesce(status, '')) not in ('DELETED', 'CANCELLED', 'NO_SHOW');

commit;
