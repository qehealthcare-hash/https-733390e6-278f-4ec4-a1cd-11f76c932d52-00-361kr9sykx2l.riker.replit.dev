-- Follow-up to 20260613100000 / 20260613110000.
--
-- The Phase-4 protection trigger (hh_protect_duty_ledger_row) blocks writes to
-- duty-materialized ledger rows unless either the caller is `service_role` or
-- the transaction-local flag `hominal.duty_ledger_write` is set. The original
-- migration only patched `hominal_materialize_due_duty_days` and
-- `hominal_repair_duty_ledger_window` to set the flag — but several other
-- SECURITY DEFINER / INVOKER RPCs also create or delete `duty:%` ledger rows:
--
--   * hominal_dedup_billing_diary       (DEFINER, runs as owner=postgres)
--   * hominal_generate_from_duty_range  (DEFINER, runs as owner=postgres)
--   * hominal_replace_service_entries   (INVOKER, runs as caller=authenticated)
--   * hominal_replace_payout_charges    (INVOKER, runs as caller=authenticated)
--
-- None of those resolve to `service_role` inside the trigger, so every one of
-- them started failing with "Duty-calendar ledger rows can only be created by
-- the Duty Calendar materializer." This patch injects the flag at the top of
-- each function body (idempotent — skips if already present), matching the
-- mechanism the original migration established.

begin;

do $patch$
declare
  v_def text;
  v_sig text;
  v_sigs text[] := array[
    'public.hominal_dedup_billing_diary(text)',
    'public.hominal_generate_from_duty_range(text, text[], jsonb, text)',
    'public.hominal_replace_service_entries(text, jsonb)',
    'public.hominal_replace_payout_charges(text, jsonb)'
  ];
begin
  foreach v_sig in array v_sigs
  loop
    begin
      v_def := pg_get_functiondef(v_sig::regprocedure);
    exception when others then
      raise notice 'skip: function % not found', v_sig;
      continue;
    end;

    if v_def is null then
      raise notice 'skip: function % has no definition', v_sig;
      continue;
    end if;

    if v_def like '%duty_ledger_write%' then
      raise notice 'skip: % already sets duty_ledger_write', v_sig;
      continue;
    end if;

    -- Inject the flag right after the first body BEGIN.
    v_def := regexp_replace(
      v_def,
      E'\nbegin\n',
      E'\nbegin\n  perform set_config(''hominal.duty_ledger_write'', ''1'', true);\n',
      1
    );

    if v_def not like '%duty_ledger_write%' then
      raise exception 'failed to patch %: no body BEGIN matched', v_sig;
    end if;

    execute v_def;
    raise notice 'patched % to set duty_ledger_write', v_sig;
  end loop;
end;
$patch$;

commit;
