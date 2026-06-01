-- Revoke anon EXECUTE on audit probes and business RPCs.
-- CRM API routes use service_role; authenticated JWT may call hominal_* RPCs.
-- Audit probes remain callable via service_role (tests/audit_checks).

revoke execute on function public.audit_probe_p1_4_ok() from anon;
revoke execute on function public.audit_probe_p1_11_ok() from anon;
revoke execute on function public.audit_probe_p1_12_ok() from anon;
revoke execute on function public.audit_probe_p1_13_ok() from anon;
revoke execute on function public.audit_probe_p1_14_ok() from anon;

revoke execute on function public.hominal_close_patient(text, text, text) from anon;
revoke execute on function public.hominal_generate_final_invoice(text, text, text) from anon;
revoke execute on function public.hominal_dedup_billing_diary(text) from anon;
revoke execute on function public._hh_require_role(text[]) from anon;

grant execute on function public.audit_probe_p1_4_ok() to authenticated, service_role;
grant execute on function public.audit_probe_p1_11_ok() to authenticated, service_role;
grant execute on function public.audit_probe_p1_12_ok() to authenticated, service_role;
grant execute on function public.audit_probe_p1_13_ok() to authenticated, service_role;
grant execute on function public.audit_probe_p1_14_ok() to authenticated, service_role;
