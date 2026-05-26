-- =============================================================================
-- Migration 044 — Corporate audit Phase 1 (DB + Supabase sync)
--
-- 1. Revoke anon/PUBLIC execute on privileged public RPCs
-- 2. Tighten hh_app_settings RLS (read active users; write Admin/Manager)
-- 3. Remove permissive hh_audit_logs INSERT for authenticated (API uses service role)
-- 4. Drop duplicate CASCADE FK on hh_billings.patient_id (keep RESTRICT)
-- 5. Add FK hh_paid_transactions.payout_id → hh_payouts(id)
-- 6. Add missing FK indexes + phone lookup indexes
-- =============================================================================

begin;

-- ── 1. Lock down RPC grants (anon must not call financial / sequence RPCs) ──

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'hominal\_%' escape '\'
        or p.proname like 'hh\_%' escape '\'
      )
      and p.proname not in (
        'hh_current_app_user',
        'hh_is_active_app_user',
        'hh_auth_email',
        'hh_has_role',
        'hh_current_role',
        'hh_current_actor',
        'hh_set_updated_at'
      )
  loop
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end $$;

-- Re-grant authenticated on RPCs the Next.js API invokes with user JWT + RLS helpers.
grant execute on function public.hh_lookup_login(text) to authenticated;
grant execute on function public.hh_current_app_user() to authenticated;
grant execute on function public.hh_is_active_app_user() to authenticated;
grant execute on function public.hh_auth_email() to authenticated;
grant execute on function public.hh_has_role(text[]) to authenticated;
grant execute on function public.hh_current_role() to authenticated;
grant execute on function public.hh_current_actor() to authenticated;

grant execute on function public.hominal_replace_service_entries(text, jsonb) to authenticated;
grant execute on function public.hominal_replace_payout_charges(text, jsonb) to authenticated;
grant execute on function public.hominal_save_receipt(jsonb) to authenticated;
grant execute on function public.hominal_soft_delete_receipt(text, text, text) to authenticated;
grant execute on function public.hominal_flip_billing_status(text, text, text, timestamptz) to authenticated;
grant execute on function public.hominal_delete_invoice(text, text) to authenticated;
grant execute on function public.hh_convert_inquiry_to_patient(text) to authenticated;
grant execute on function public.hh_recompute_payout(text, text) to authenticated;
grant execute on function public.hh_employee_pending_payout(text, text) to authenticated;
grant execute on function public.hh_employees_pending_for_period(text) to authenticated;
grant execute on function public.hh_next_invoice_no() to authenticated;
grant execute on function public.hh_next_receipt_no() to authenticated;
grant execute on function public.hh_next_paid_tx_serial() to authenticated;
grant execute on function public.hh_compact_invoice_seq() to authenticated;

-- ── 2. hh_app_settings: split read vs Admin/Manager write ───────────────────

drop policy if exists hh_app_settings_modify on public.hh_app_settings;
drop policy if exists hh_app_settings_authenticated_access on public.hh_app_settings;
drop policy if exists hh_app_settings_public_access on public.hh_app_settings;

drop policy if exists hh_app_settings_read on public.hh_app_settings;
create policy hh_app_settings_read on public.hh_app_settings
  for select to authenticated
  using (public.hh_is_active_app_user());

drop policy if exists hh_app_settings_write on public.hh_app_settings;
create policy hh_app_settings_write on public.hh_app_settings
  for insert to authenticated
  with check (public.hh_has_role(array['Admin', 'Manager']));

create policy hh_app_settings_update on public.hh_app_settings
  for update to authenticated
  using (public.hh_has_role(array['Admin', 'Manager']))
  with check (public.hh_has_role(array['Admin', 'Manager']));

create policy hh_app_settings_delete on public.hh_app_settings
  for delete to authenticated
  using (public.hh_has_role(array['Admin', 'Manager']));

-- ── 3. hh_audit_logs: no forged inserts from authenticated clients ──────────

drop policy if exists hh_audit_logs_insert_authenticated on public.hh_audit_logs;

-- ── 4. Duplicate FK on hh_billings.patient_id ───────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
    where t.relname = 'hh_billings'
      and a.attname = 'patient_id'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%on delete cascade%'
  loop
    execute format('alter table public.hh_billings drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- ── 5. hh_paid_transactions.payout_id FK (skip if orphans exist) ────────────

do $$
begin
  if exists (
    select 1
    from public.hh_paid_transactions pt
    where pt.payout_id is not null
      and pt.payout_id <> ''
      and not exists (
        select 1 from public.hh_payouts po where po.id = pt.payout_id
      )
  ) then
    raise notice '044: skipping payout_id FK — orphan paid_transactions rows exist';
  elsif not exists (
    select 1
    from pg_constraint
    where conname = 'hh_paid_transactions_payout_id_fkey'
  ) then
    alter table public.hh_paid_transactions
      add constraint hh_paid_transactions_payout_id_fkey
      foreign key (payout_id) references public.hh_payouts (id)
      on delete restrict;
  end if;
end $$;

-- ── 6. Indexes ──────────────────────────────────────────────────────────────

create index if not exists idx_hh_inquiries_assigned_to
  on public.hh_inquiries (assigned_to);

create index if not exists idx_hh_svc_entries_partner_id
  on public.hh_svc_entries (partner_id);

create index if not exists idx_hh_patients_phone
  on public.hh_patients (phone);

create index if not exists idx_hh_employees_phone
  on public.hh_employees (phone);

commit;
