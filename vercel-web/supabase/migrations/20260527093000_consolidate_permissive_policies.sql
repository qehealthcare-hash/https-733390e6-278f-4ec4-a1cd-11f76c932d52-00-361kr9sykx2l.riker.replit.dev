-- Consolidate duplicate permissive RLS policies flagged by the Supabase advisor.
-- Each affected table currently has two permissive policies that overlap on SELECT
-- (one explicit SELECT policy and one ALL policy). PostgREST evaluates both on
-- every read, which is the source of the multiple_permissive_policies warning.
--
-- For tables where the two policies share the same predicate we drop the
-- SELECT-only policy and rely on the ALL policy. For hh_app_settings and
-- hh_audit_logs the dropped policies used USING (true), so removing them also
-- tightens reads to hh_is_active_app_user(). For hh_payouts we split the
-- role-gated ALL policy into explicit INSERT/UPDATE/DELETE policies so SELECT
-- is only governed by the active-user read policy (no behavioural change for
-- writes – still Admin/Accountant/Manager only).

begin;

drop policy if exists hh_ai_conversations_auth_read on public.hh_ai_conversations;
drop policy if exists hh_ai_messages_auth_read on public.hh_ai_messages;
drop policy if exists hh_attendance_auth_read on public.hh_attendance;
drop policy if exists hh_duties_auth_read on public.hh_duties;
drop policy if exists hh_whatsapp_messages_auth_read on public.hh_whatsapp_messages;

drop policy if exists hh_app_settings_select on public.hh_app_settings;
drop policy if exists hh_audit_logs_select_authenticated on public.hh_audit_logs;

drop policy if exists hh_payouts_role_write on public.hh_payouts;

create policy hh_payouts_role_insert on public.hh_payouts
  for insert to authenticated
  with check (hh_has_role(array['Admin','Accountant','Manager']));

create policy hh_payouts_role_update on public.hh_payouts
  for update to authenticated
  using (hh_has_role(array['Admin','Accountant','Manager']))
  with check (hh_has_role(array['Admin','Accountant','Manager']));

create policy hh_payouts_role_delete on public.hh_payouts
  for delete to authenticated
  using (hh_has_role(array['Admin','Accountant','Manager']));

commit;
