-- P1-69 follow-up: hominal_dedup_billing_diary phantom cleanup must use the
-- same effective duty end as materializeDuty (open-ended → today in IST).
-- Previously it compared svc_entry.date to raw d.end_at, so rows materialized
-- through today were deleted as "phantoms" when end_at was capped on a prior
-- bill close (e.g. end_at = 2026-05-27 while today is June). That produced
-- "31 days on duty calendar, 27 on billing".

set search_path = public, pg_temp;

create or replace function public.hominal_dedup_billing_diary(p_billing_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_svc_phantom int := 0;
  v_payout_phantom int := 0;
  v_svc_dedup int := 0;
  v_payout_dedup int := 0;
  v_today_ist date := (timezone('Asia/Kolkata', now()))::date;
begin
  if p_billing_id is null or btrim(p_billing_id) = '' then
    return jsonb_build_object('error', 'billing_id is required');
  end if;

  -- 1a. svc phantoms: date outside parent duty's IST window, where the
  -- upper bound is LEAST(duty end IST, today IST) — mirrors
  -- effectiveMaterializeEndAt in the app layer.
  with phantom as (
    select se.id
    from public.hh_svc_entries se
    join public.hh_duties d
      on d.id = (regexp_match(se.remarks, 'duty:([^:]+):'))[1]
    where se.billing_id = p_billing_id
      and se.date <> ''
      and (
        se.date::date < (d.start_at at time zone 'Asia/Kolkata')::date
        or se.date::date > least(
          (d.end_at at time zone 'Asia/Kolkata')::date,
          v_today_ist
        )
      )
  )
  delete from public.hh_svc_entries
   where id in (select id from phantom);
  get diagnostics v_svc_phantom = row_count;

  -- 1b. payout phantoms: same rule.
  with phantom as (
    select pc.id
    from public.hh_payout_charges pc
    join public.hh_duties d
      on d.id = (regexp_match(pc.remarks, 'duty:([^:]+):'))[1]
    where pc.billing_id = p_billing_id
      and pc.date <> ''
      and (
        pc.date::date < (d.start_at at time zone 'Asia/Kolkata')::date
        or pc.date::date > least(
          (d.end_at at time zone 'Asia/Kolkata')::date,
          v_today_ist
        )
      )
  )
  delete from public.hh_payout_charges
   where id in (select id from phantom);
  get diagnostics v_payout_phantom = row_count;

  -- 2a. svc per-day dedup: keep entry from latest-started duty.
  with annotated as (
    select se.id, se.date,
      (regexp_match(se.remarks, 'duty:([^:]+):'))[1] as duty_id
    from public.hh_svc_entries se
    where se.billing_id = p_billing_id and se.date <> ''
  ),
  ranked as (
    select a.id, a.date,
      row_number() over (
        partition by a.date
        order by coalesce(d.start_at, '1900-01-01'::timestamptz) desc,
                 a.id
      ) as rn
    from annotated a
    left join public.hh_duties d on d.id = a.duty_id
  )
  delete from public.hh_svc_entries
   where id in (select id from ranked where rn > 1);
  get diagnostics v_svc_dedup = row_count;

  -- 2b. payout per-(date, employee) dedup: keep latest-started duty.
  with annotated as (
    select pc.id, pc.date, pc.partner_id,
      (regexp_match(pc.remarks, 'duty:([^:]+):'))[1] as duty_id
    from public.hh_payout_charges pc
    where pc.billing_id = p_billing_id and pc.date <> ''
  ),
  ranked as (
    select a.id, a.date, a.partner_id,
      row_number() over (
        partition by a.date, a.partner_id
        order by coalesce(d.start_at, '1900-01-01'::timestamptz) desc,
                 a.id
      ) as rn
    from annotated a
    left join public.hh_duties d on d.id = a.duty_id
  )
  delete from public.hh_payout_charges
   where id in (select id from ranked where rn > 1);
  get diagnostics v_payout_dedup = row_count;

  return jsonb_build_object(
    'svc_phantoms_deleted', v_svc_phantom,
    'payout_phantoms_deleted', v_payout_phantom,
    'svc_duplicates_deleted', v_svc_dedup,
    'payout_duplicates_deleted', v_payout_dedup
  );
end;
$function$;

revoke all on function public.hominal_dedup_billing_diary(text) from public;
grant execute on function public.hominal_dedup_billing_diary(text) to authenticated;
