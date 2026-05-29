-- Duty diary dedup helper.
--
-- After every materializeDuty pass, the service layer calls this function
-- to enforce two invariants on a single billing's diary:
--
--   1) PHANTOM CLEANUP: every svc_entry / payout_charge belongs to a duty
--      whose IST calendar window covers its date. Rows outside the IST
--      window (e.g. an Apr-30 row whose duty actually starts May-1 IST)
--      are deleted.
--
--   2) PER-DAY DEDUP: a single billing day produces ONE svc_entry. On
--      handovers (Duty A ends, Duty B starts on the same date) and on
--      overlapping duties (open-ended placeholder + actual assignment),
--      the entry from the duty with the latest start_at wins. Payout
--      charges dedup per (date, employee) so each partner still gets
--      paid for their share of work.
--
-- Safe to re-run; idempotent.

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
begin
  if p_billing_id is null or btrim(p_billing_id) = '' then
    return jsonb_build_object('error', 'billing_id is required');
  end if;

  -- 1a. svc phantoms: date outside parent duty's IST calendar window.
  with phantom as (
    select se.id
    from public.hh_svc_entries se
    join public.hh_duties d
      on d.id = (regexp_match(se.remarks, 'duty:([^:]+):'))[1]
    where se.billing_id = p_billing_id
      and se.date <> ''
      and (
        se.date::date < (d.start_at at time zone 'Asia/Kolkata')::date
        or se.date::date > (d.end_at   at time zone 'Asia/Kolkata')::date
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
        or pc.date::date > (d.end_at   at time zone 'Asia/Kolkata')::date
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
