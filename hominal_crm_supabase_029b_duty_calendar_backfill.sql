-- Phase 29b — Backfill duty charge/payout rates from legacy diary rows.
-- Safe to re-run.

begin;

update public.hh_duties
set service_name = 'Care Taker Services'
where coalesce(trim(service_name), '') = ''
   or lower(trim(service_name)) in ('care taker', 'caretaker');

update public.hh_duties d
set charge_per_day = sub.amt
from (
  select distinct on (d2.id)
    d2.id as duty_id,
    coalesce(s.amt, 0) as amt
  from public.hh_duties d2
  inner join public.hh_svc_entries s
    on s.billing_id = d2.billing_id
   and lower(trim(s.service_name)) = lower(
     trim(coalesce(nullif(d2.service_name, ''), nullif(d2.service_type, ''), 'Care Taker Services'))
   )
  where coalesce(d2.charge_per_day, 0) = 0
    and coalesce(d2.billing_id, '') <> ''
    and coalesce(s.amt, 0) > 0
  order by d2.id, s.date desc nulls last
) sub
where d.id = sub.duty_id;

update public.hh_duties d
set payout_per_day = sub.amt
from (
  select distinct on (d2.id)
    d2.id as duty_id,
    coalesce(p.amount, 0) as amt
  from public.hh_duties d2
  inner join public.hh_payout_charges p
    on p.svc_key = d2.billing_id || '_' || trim(
      coalesce(nullif(d2.service_name, ''), nullif(d2.service_type, ''), 'Care Taker Services')
    )
  where coalesce(d2.payout_per_day, 0) = 0
    and coalesce(d2.billing_id, '') <> ''
    and coalesce(p.amount, 0) > 0
  order by d2.id, p.date desc nulls last
) sub
where d.id = sub.duty_id;

commit;
