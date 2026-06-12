-- Hominal Healthcare CRM
-- Fix duty calendar sync for billing + payout:
-- the materializer previously decided a duty was already synced when the
-- primary employee payout row existed, even if extra partner payout rows were
-- still missing. Keep patient billing one charge per day/service, but detect
-- missing payout rows for every duty partner.

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
        or not exists (
          select 1
          from public.hh_payout_charges p
          where coalesce(p.remarks, '') =
            ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || coalesce(d.employee_id, ''))
        )
$old$;

  v_new := $new$
        or exists (
          select 1
          from (
            select coalesce(d.employee_id, '') as employee_id
            union all
            select coalesce(item->>'employee_id', '') as employee_id
            from jsonb_array_elements(coalesce(d.extra_partners, '[]'::jsonb)) item
          ) partner_missing
          where partner_missing.employee_id <> ''
            and not exists (
              select 1
              from public.hh_payout_charges p
              where coalesce(p.remarks, '') =
                ('duty:' || d.id || ':' || (gs.day_at::date)::text || ':' || partner_missing.employee_id)
            )
        )
$new$;

  if position(v_old in v_function) = 0 then
    raise exception 'Expected primary-only payout detection block was not found in hominal_materialize_due_duty_days';
  end if;

  execute replace(v_function, v_old, v_new);
end $$;

commit;
