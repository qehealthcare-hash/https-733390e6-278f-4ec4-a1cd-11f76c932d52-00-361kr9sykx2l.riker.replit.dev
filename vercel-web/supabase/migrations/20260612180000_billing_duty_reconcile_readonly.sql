-- Step 1 of the data-integrity program: read-only reconciliation reporter.
-- Purpose: surface mismatches between the billing/payout day ledger
-- (hh_svc_entries / hh_payout_charges, remarks 'duty:<dutyId>:<date>:<employeeId>')
-- and the duty definitions (hh_duties). This function is STABLE and performs
-- SELECT-only work: it never mutates data. Run it in report mode before any
-- recovery/restore step.

create or replace function public.hominal_billing_duty_reconcile(
  p_from text default null,   -- inclusive 'YYYY-MM-DD' lower bound on service day (optional)
  p_to   text default null    -- inclusive 'YYYY-MM-DD' upper bound on service day (optional)
)
returns table (
  classification text,
  duty_id        text,
  patient_id     text,
  employee_id    text,
  billing_id     text,
  service_day    text,
  service_name   text,
  amount         numeric,
  detail         text
)
language sql
stable
security definer
set search_path = public
as $$
  -- 1) Billing day-row whose referenced duty no longer exists (hard-deleted parent).
  select
    'billing_on_missing_duty'::text,
    split_part(s.remarks, ':', 2),
    b.patient_id,
    split_part(s.remarks, ':', 4),
    s.billing_id,
    split_part(s.remarks, ':', 3),
    s.service_name,
    s.total,
    'svc row references a duty id that is absent from hh_duties'::text
  from public.hh_svc_entries s
  left join public.hh_billings b on b.id = s.billing_id
  where s.remarks like 'duty:%'
    and not exists (
      select 1 from public.hh_duties d where d.id = split_part(s.remarks, ':', 2)
    )
    and (p_from is null or split_part(s.remarks, ':', 3) >= p_from)
    and (p_to   is null or split_part(s.remarks, ':', 3) <= p_to)

  union all
  -- 2) Billing day-row whose referenced duty is soft-deleted / cancelled.
  select
    'billing_on_deleted_duty',
    d.id,
    d.patient_id,
    split_part(s.remarks, ':', 4),
    s.billing_id,
    split_part(s.remarks, ':', 3),
    s.service_name,
    s.total,
    'svc row references a duty marked DELETED/CANCELLED/NO_SHOW or with deleted_at set'
  from public.hh_svc_entries s
  join public.hh_duties d on d.id = split_part(s.remarks, ':', 2)
  where s.remarks like 'duty:%'
    and (d.status in ('DELETED', 'CANCELLED', 'NO_SHOW') or d.deleted_at is not null)
    and (p_from is null or split_part(s.remarks, ':', 3) >= p_from)
    and (p_to   is null or split_part(s.remarks, ':', 3) <= p_to)

  union all
  -- 3) Active duty (already started) with zero duty-linked billing rows.
  select
    'duty_without_billing',
    d.id,
    d.patient_id,
    d.employee_id,
    d.billing_id,
    to_char(d.start_at, 'YYYY-MM-DD'),
    d.service_name,
    d.charge_per_day,
    'active, started duty has no duty-linked svc rows'
  from public.hh_duties d
  where coalesce(d.status, '') not in ('DELETED', 'CANCELLED', 'NO_SHOW')
    and d.deleted_at is null
    and d.start_at < now()
    and not exists (
      select 1 from public.hh_svc_entries s
      where s.remarks like 'duty:' || d.id || ':%'
    )
    and (p_from is null or to_char(d.start_at, 'YYYY-MM-DD') >= p_from)
    and (p_to   is null or to_char(d.start_at, 'YYYY-MM-DD') <= p_to);
$$;

comment on function public.hominal_billing_duty_reconcile(text, text) is
  'Read-only reconciliation: classifies mismatches between the billing/payout day ledger and hh_duties. SELECT-only; safe to run in production.';
