-- R3 (B2): DB audit triggers on core operational tables missing `trg_audit_*`.
--
-- Covers: hh_duties, hh_attendance, hh_payouts (never wired in 012), and
-- hh_patients / hh_employees / hh_inquiries (026/027 dropped triggers for
-- service-layer audit only — restored here for RPC / legacy / direct writes).
--
-- `/api/v1` mutations that call `writeMutationAudit` may produce paired rows
-- (trigger uses SQL op names insert|update|delete; service uses create|update|…).

begin;

-- Ensure audit columns exist on all six tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'hh_duties', 'hh_attendance', 'hh_payouts',
    'hh_patients', 'hh_employees', 'hh_inquiries'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists created_by text', t);
      execute format('alter table public.%I add column if not exists updated_by text', t);
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- C2 fix: coalesce updated_by; capture v_after after stamps (migration 013).
create or replace function public.hh_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_module text := tg_argv[0];
  v_entity text;
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  v_action := lower(tg_op);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.hh_current_actor());
    new.updated_by := coalesce(new.updated_by, new.created_by, public.hh_current_actor());
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    new.updated_by := coalesce(nullif(new.updated_by, old.updated_by), public.hh_current_actor());
    new.updated_at := now();
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_entity := coalesce(old.id::text, '');
  end if;

  insert into public.hh_audit_logs(module, entity_id, action, actor, before, after, stamp)
  values (v_module, v_entity, v_action, public.hh_current_actor(), v_before, v_after, now()::text);

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$function$;

do $$
declare
  cfg record;
begin
  for cfg in (
    select * from (values
      ('hh_duties', 'duty'),
      ('hh_attendance', 'attendance'),
      ('hh_payouts', 'payout'),
      ('hh_patients', 'patient'),
      ('hh_employees', 'employee'),
      ('hh_inquiries', 'inquiry')
    ) as v(table_name, module)
  )
  loop
    if to_regclass('public.' || cfg.table_name) is not null then
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
        cfg.module
      );
    end if;
  end loop;
end $$;

commit;
