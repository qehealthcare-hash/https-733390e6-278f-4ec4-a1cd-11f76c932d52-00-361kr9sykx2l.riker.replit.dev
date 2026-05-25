-- =============================================================================
-- Migration 035 — Duty calendar 100/100 final hardening
--
-- 1. Atomic billing status flip with pg_advisory_xact_lock + row FOR UPDATE
-- 2. Realtime publication for hh_duties (+ hh_attendance for attendance sync)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Atomic Active <-> Closed flip (used after JS-side duty cap / resume)
-- ---------------------------------------------------------------------------
create or replace function public.hominal_flip_billing_status(
  p_billing_id text,
  p_target_status text,
  p_actor text,
  p_closed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.hh_billings%rowtype;
  v_target text;
begin
  if coalesce(trim(p_billing_id), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'billing_id required');
  end if;

  v_target := initcap(lower(trim(coalesce(p_target_status, ''))));
  if v_target not in ('Active', 'Closed') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'target_status must be Active or Closed');
  end if;

  select * into v_row from public.hh_billings where id = p_billing_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Billing not found');
  end if;

  -- One lock per patient so two operators cannot race close + reopen on
  -- the same patient's ledger in separate HTTP requests.
  perform pg_advisory_xact_lock(hashtext('patient_billing:' || coalesce(v_row.patient_id, '')));

  if v_target = 'Closed' then
    if initcap(v_row.status) <> 'Active' then
      return jsonb_build_object(
        'ok', false,
        'code', 'conflict',
        'message', 'Bill is not Active — refresh and retry',
        'status', v_row.status
      );
    end if;
    update public.hh_billings
       set status = 'Closed',
           closed_at = coalesce(p_closed_at, now()),
           updated_at = now(),
           updated_by = coalesce(p_actor, updated_by)
     where id = p_billing_id;
  else
    if initcap(v_row.status) <> 'Closed' then
      return jsonb_build_object(
        'ok', false,
        'code', 'conflict',
        'message', 'Bill is not Closed — refresh and retry',
        'status', v_row.status
      );
    end if;
    if exists (
      select 1
        from public.hh_billings b
       where b.patient_id = v_row.patient_id
         and initcap(b.status) = 'Active'
         and b.id <> p_billing_id
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate',
        'message', 'Patient already has another Active bill'
      );
    end if;
    update public.hh_billings
       set status = 'Active',
           closed_at = null,
           updated_at = now(),
           updated_by = coalesce(p_actor, updated_by)
     where id = p_billing_id;
  end if;

  select * into v_row from public.hh_billings where id = p_billing_id;
  return jsonb_build_object('ok', true, 'billing', to_jsonb(v_row));
end;
$$;

grant execute on function public.hominal_flip_billing_status(text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime — duty calendar + attendance rows
-- ---------------------------------------------------------------------------
alter table if exists public.hh_duties replica identity full;
alter table if exists public.hh_attendance replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['hh_duties', 'hh_attendance']
  loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
