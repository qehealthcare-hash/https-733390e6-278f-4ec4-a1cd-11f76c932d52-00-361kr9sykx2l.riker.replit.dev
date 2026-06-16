-- Phase 4 SSOT audit follow-up: hominal_billing_duty_reconcile is SECURITY
-- DEFINER and read-only, but must not be callable by anon.

begin;

revoke all on function public.hominal_billing_duty_reconcile(text, text) from public, anon;
grant execute on function public.hominal_billing_duty_reconcile(text, text) to authenticated;
grant execute on function public.hominal_billing_duty_reconcile(text, text) to service_role;

commit;
