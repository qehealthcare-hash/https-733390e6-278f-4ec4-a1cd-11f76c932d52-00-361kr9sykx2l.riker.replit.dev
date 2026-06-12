-- Hominal Healthcare CRM
-- Permanent duplicate-ledger repair.
--
-- Root cause fixed:
-- The same duty/date/employee key could be materialized under more than one
-- billing_id. Older unique indexes included billing_id, so a closed bill and a
-- new active bill could both carry the same duty day. That doubled billing and
-- payout totals.
--
-- Rule after this migration:
-- One duty-calendar day for one employee is one ledger row only:
--   remarks = duty:<duty_id>:<yyyy-mm-dd>:<employee_id>
-- Billing ID is metadata, not part of payout uniqueness.

begin;

create table if not exists public.hh_ledger_duplicate_repairs (
  id bigserial primary key,
  table_name text not null,
  kept_id text,
  removed_id text,
  duty_key text not null,
  billing_id text,
  amount numeric,
  repaired_by text not null default 'ledger-dedupe@hominal.system',
  repaired_at timestamptz not null default now()
);

-- Keep the row attached to an Active bill when possible; otherwise keep the
-- newest non-cancelled row. Remove the rest.
with ranked as (
  select
    se.ctid,
    se.id::text as row_id,
    se.remarks as duty_key,
    se.billing_id,
    se.total::numeric as amount,
    first_value(se.id::text) over (
      partition by se.remarks
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(se.updated_at, se.created_at) desc nulls last,
        se.id::text desc
    ) as kept_id,
    row_number() over (
      partition by se.remarks
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(se.updated_at, se.created_at) desc nulls last,
        se.id::text desc
    ) as rn
  from public.hh_svc_entries se
  left join public.hh_billings b on b.id = se.billing_id
  where coalesce(se.remarks, '') like 'duty:%'
),
logged as (
  insert into public.hh_ledger_duplicate_repairs (
    table_name, kept_id, removed_id, duty_key, billing_id, amount
  )
  select 'hh_svc_entries', kept_id, row_id, duty_key, billing_id, amount
  from ranked
  where rn > 1
  returning removed_id
)
delete from public.hh_svc_entries se
using logged l
where se.id::text = l.removed_id;

with ranked as (
  select
    pc.ctid,
    pc.id::text as row_id,
    pc.remarks as duty_key,
    pc.billing_id,
    pc.amount::numeric as amount,
    first_value(pc.id::text) over (
      partition by pc.remarks
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(pc.updated_at, pc.created_at) desc nulls last,
        pc.id::text desc
    ) as kept_id,
    row_number() over (
      partition by pc.remarks
      order by
        case when upper(coalesce(b.status, '')) = 'ACTIVE' then 0 else 1 end,
        coalesce(pc.updated_at, pc.created_at) desc nulls last,
        pc.id::text desc
    ) as rn
  from public.hh_payout_charges pc
  left join public.hh_billings b on b.id = pc.billing_id
  where coalesce(pc.remarks, '') like 'duty:%'
),
logged as (
  insert into public.hh_ledger_duplicate_repairs (
    table_name, kept_id, removed_id, duty_key, billing_id, amount
  )
  select 'hh_payout_charges', kept_id, row_id, duty_key, billing_id, amount
  from ranked
  where rn > 1
  returning removed_id
)
delete from public.hh_payout_charges pc
using logged l
where pc.id::text = l.removed_id;

-- Enforce the real source-of-truth uniqueness going forward.
create unique index if not exists uq_hh_svc_entries_duty_key_once
  on public.hh_svc_entries (remarks)
  where coalesce(remarks, '') like 'duty:%';

create unique index if not exists uq_hh_payout_charges_duty_key_once
  on public.hh_payout_charges (remarks)
  where coalesce(remarks, '') like 'duty:%';

-- Recompute every non-paid payout from the cleaned duty-calendar payout
-- ledger. Paid payouts stay historical.
with charge_rollup as (
  select
    pc.partner_id as employee_id,
    substr(pc.date, 1, 7) as period_month,
    count(*)::numeric as duty_count,
    coalesce(sum(pc.amount), 0)::numeric as gross_amount,
    coalesce(sum(public.hh_reconciliation_hours_for_term(pc.term)), 0)::numeric as hours
  from public.hh_payout_charges pc
  where coalesce(pc.partner_id, '') <> ''
    and coalesce(pc.date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  group by pc.partner_id, substr(pc.date, 1, 7)
)
update public.hh_payouts p
set gross_amount = r.gross_amount,
    duty_count = r.duty_count,
    hours = r.hours,
    net_amount = r.gross_amount,
    updated_by = 'ledger-dedupe@hominal.system',
    updated_at = now()
from charge_rollup r
where p.employee_id = r.employee_id
  and p.period_month = r.period_month
  and upper(coalesce(p.status, '')) <> 'PAID';

insert into public.hh_audit_logs (module, entity_id, action, stamp, payload)
select
  'duty-ledger',
  'duplicate-duty-key-repair',
  'sync',
  'Duplicate duty ledger keys repaired by ledger-dedupe@hominal.system on ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  jsonb_build_object(
    'svc_rows_removed', count(*) filter (where table_name = 'hh_svc_entries'),
    'payout_rows_removed', count(*) filter (where table_name = 'hh_payout_charges'),
    'rule', 'unique remarks for duty:<duty_id>:<date>:<employee_id>'
  )
from public.hh_ledger_duplicate_repairs
where repaired_at >= now() - interval '5 minutes';

commit;
