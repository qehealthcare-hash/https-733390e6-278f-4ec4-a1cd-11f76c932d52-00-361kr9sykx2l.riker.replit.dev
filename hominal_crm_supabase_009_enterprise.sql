-- Hominal CRM enterprise hardening (apply after hominal_crm_supabase_hardening.sql)
-- 1) Stop anonymous login lookup (use authenticated session only)
-- 2) Keep hh_* RLS tied to active app users
-- 3) Block direct PostgREST access to normalized ledger tables (API service role only)

begin;

revoke execute on function public.hh_lookup_login(text) from anon;
grant execute on function public.hh_lookup_login(text) to authenticated;

-- Ledger tables: RLS on, no policies for authenticated → deny direct client reads/writes.
do $$
declare
  ledger_table text;
begin
  foreach ledger_table in array array[
    'patient_services',
    'billing_receipts',
    'staff_payouts',
    'invoices',
    'invoice_payments'
  ]
  loop
    if to_regclass('public.' || ledger_table) is not null then
      execute format('alter table public.%I enable row level security', ledger_table);
      execute format('drop policy if exists %I on public.%I', ledger_table || '_authenticated_read', ledger_table);
      execute format('drop policy if exists %I on public.%I', ledger_table || '_authenticated_write', ledger_table);
    end if;
  end loop;
end
$$;

commit;
