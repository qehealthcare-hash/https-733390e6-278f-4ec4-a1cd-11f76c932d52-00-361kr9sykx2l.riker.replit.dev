-- Phase 2 SSOT: unique duty-day slot on (duty_id, date, partner_id)
-- Replaces remarks-only indexes (duty_key_once, duty_day_staff).

begin;

do $flag$
begin
  perform set_config('hominal.duty_ledger_write', '1', true);
end;
$flag$;

with ranked as (
  select
    se.id::text as row_id,
    se.duty_id,
    se.date,
    coalesce(se.partner_id, '') as partner_id,
    se.billing_id,
    se.total::numeric as amount,
    first_value(se.id::text) over (
      partition by se.duty_id, se.date, coalesce(se.partner_id, '')
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(se.updated_at, se.created_at) desc nulls last,
        se.id::text desc
    ) as kept_id,
    row_number() over (
      partition by se.duty_id, se.date, coalesce(se.partner_id, '')
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(se.updated_at, se.created_at) desc nulls last,
        se.id::text desc
    ) as rn
  from public.hh_svc_entries se
  left join public.hh_billings b on b.id = se.billing_id
  where se.duty_id is not null
    and coalesce(se.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
),
logged as (
  insert into public.hh_ledger_duplicate_repairs (
    table_name, kept_id, removed_id, duty_key, billing_id, amount, repaired_by
  )
  select
    'hh_svc_entries',
    kept_id,
    row_id,
    'duty:' || duty_id || ':' || date || ':' || partner_id,
    billing_id,
    amount,
    'phase2-duty-id-day-partner-index'
  from ranked
  where rn > 1
  returning removed_id
)
delete from public.hh_svc_entries se
using logged l
where se.id::text = l.removed_id;

with ranked as (
  select
    pc.id::text as row_id,
    pc.duty_id,
    pc.date,
    coalesce(pc.partner_id, '') as partner_id,
    pc.billing_id,
    pc.amount::numeric as amount,
    first_value(pc.id::text) over (
      partition by pc.duty_id, pc.date, coalesce(pc.partner_id, '')
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(pc.updated_at, pc.created_at) desc nulls last,
        pc.id::text desc
    ) as kept_id,
    row_number() over (
      partition by pc.duty_id, pc.date, coalesce(pc.partner_id, '')
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(pc.updated_at, pc.created_at) desc nulls last,
        pc.id::text desc
    ) as rn
  from public.hh_payout_charges pc
  left join public.hh_billings b on b.id = pc.billing_id
  where pc.duty_id is not null
    and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
),
logged as (
  insert into public.hh_ledger_duplicate_repairs (
    table_name, kept_id, removed_id, duty_key, billing_id, amount, repaired_by
  )
  select
    'hh_payout_charges',
    kept_id,
    row_id,
    'duty:' || duty_id || ':' || date || ':' || partner_id,
    billing_id,
    amount,
    'phase2-duty-id-day-partner-index'
  from ranked
  where rn > 1
  returning removed_id
)
delete from public.hh_payout_charges pc
using logged l
where pc.id::text = l.removed_id;

drop index if exists public.uq_hh_svc_entries_duty_key_once;
drop index if exists public.uq_hh_payout_charges_duty_key_once;
drop index if exists public.uq_hh_svc_entries_duty_day_staff;
drop index if exists public.uq_hh_payout_charges_duty_day_staff;

create unique index if not exists uq_hh_svc_entries_duty_day_partner
  on public.hh_svc_entries (duty_id, date, coalesce(partner_id, ''))
  where duty_id is not null
    and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

create unique index if not exists uq_hh_payout_charges_duty_day_partner
  on public.hh_payout_charges (duty_id, date, coalesce(partner_id, ''))
  where duty_id is not null
    and coalesce(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

insert into public.hh_audit_logs (module, entity_id, action, stamp, payload)
select
  'duty-ledger',
  'phase2-duty-id-day-partner-index',
  'sync',
  'Duty ledger uniqueness migrated to (duty_id, date, partner_id) on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  jsonb_build_object(
    'svc_rows_removed', count(*) filter (where table_name = 'hh_svc_entries'),
    'payout_rows_removed', count(*) filter (where table_name = 'hh_payout_charges'),
    'rule', 'unique (duty_id, date, partner_id) for duty-calendar rows'
  )
from public.hh_ledger_duplicate_repairs
where repaired_by = 'phase2-duty-id-day-partner-index'
  and repaired_at >= now() - interval '5 minutes';

commit;
