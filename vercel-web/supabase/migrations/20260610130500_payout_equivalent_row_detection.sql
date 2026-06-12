-- Hominal Healthcare CRM
-- Payout sync must be idempotent by the real payout uniqueness rule:
-- one payout charge per active bill + service day + service type + staff.
-- This prevents overlapping/duplicate duty records from being interpreted as
-- missing payout ledger rows when an equivalent charge already exists.

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
              where coalesce(p.remarks, '') in (
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id),
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id || ':m')
              )
$old$;

  v_new := $new$
              where p.billing_id = b.id
                and coalesce(p.date, '') = (gs.day_at::date)::text
                and coalesce(p.partner_id, '') = partner_missing.employee_id
                and lower(coalesce(p.service_name, '')) =
                    lower(coalesce(nullif(d.service_name, ''), nullif(d.service_type, ''), 'Care Taker Services'))
$new$;

  if position(v_old in v_function) = 0 then
    raise exception 'Expected payout compatibility detection block was not found in hominal_materialize_due_duty_days';
  end if;

  execute replace(v_function, v_old, v_new);
end $$;

commit;
