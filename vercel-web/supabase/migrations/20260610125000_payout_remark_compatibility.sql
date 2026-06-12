-- Hominal Healthcare CRM
-- Older duty payout rows used a trailing ":m" marker in remarks. Treat those
-- rows as already materialized so the sync job does not repeatedly attempt to
-- recreate equivalent payout charges.

begin;

do $$
declare
  v_function text;
  v_old text;
  v_new text;
begin
  v_function := pg_get_functiondef(
    'public.hominal_materialize_due_duty_days(date, date, integer, text)'::regprocedure
  );

  v_old := $old$
              where coalesce(p.remarks, '') =
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id)
$old$;

  v_new := $new$
              where coalesce(p.remarks, '') in (
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id),
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id || ':m')
              )
$new$;

  if position(v_old in v_function) = 0 then
    raise exception 'Expected payout remark detection block was not found in hominal_materialize_due_duty_days';
  end if;

  execute replace(v_function, v_old, v_new);
end $$;

commit;
