-- Hominal Healthcare CRM
-- Duty Calendar = single source of truth: replace-slice writers cannot touch
-- duty-derived rows.
--
-- Root cause fixed:
-- The legacy "replace whole slice" writers used by Billing/Payout
-- (hominal_replace_service_entries / hominal_replace_payout_charges) did a
-- blunt `delete ... where svc_key = p_svc_key` that ALSO removed the
-- duty-calendar materialized rows (remarks `duty:<dutyId>:<date>:<employeeId>`),
-- then re-inserted whatever the caller supplied. A Billing or Payout save could
-- therefore silently delete or overwrite duty charges, breaking the rule that
-- duty data is owned only by the Duty Calendar.
--
-- Rule after this migration:
-- These replace writers operate ONLY on non-duty (manual / legacy) rows:
--   1. They delete only rows where remarks NOT LIKE 'duty:%' for the slice.
--   2. They skip any incoming row whose remarks LIKE 'duty:%' (Billing/Payout
--      can never inject a duty-calendar row).
-- Duty-materialized rows are preserved untouched and remain owned by the
-- Duty Calendar materializer.

begin;

create or replace function public.hominal_replace_service_entries(p_svc_key text, p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer := 0;
begin
  if p_svc_key is null or btrim(p_svc_key) = '' then
    raise exception 'p_svc_key is required';
  end if;

  -- Preserve duty-calendar rows: only the manual / legacy slice is replaceable.
  delete from public.hh_svc_entries
  where svc_key = p_svc_key
    and coalesce(remarks, '') not like 'duty:%';

  insert into public.hh_svc_entries (
    svc_key, billing_id, service_name, partner, date, freq,
    amt, count, disc, total, remarks, partner_id
  )
  select
    p_svc_key,
    coalesce(x.billing_id, ''),
    coalesce(x.service_name, ''),
    coalesce(x.partner, ''),
    coalesce(x.date, ''),
    coalesce(x.freq, ''),
    coalesce(x.amt, 0),
    coalesce(x.count, 1),
    coalesce(x.disc, 0),
    coalesce(x.total, 0),
    coalesce(x.remarks, ''),
    nullif(x.partner_id, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    svc_key text,
    billing_id text,
    service_name text,
    partner text,
    date text,
    freq text,
    amt numeric,
    count numeric,
    disc numeric,
    total numeric,
    remarks text,
    partner_id text
  )
  -- Reject any attempt to inject a duty-calendar row through this path.
  where coalesce(x.remarks, '') not like 'duty:%';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hominal_replace_payout_charges(p_svc_key text, p_rows jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer := 0;
begin
  if p_svc_key is null or btrim(p_svc_key) = '' then
    raise exception 'p_svc_key is required';
  end if;

  -- Preserve duty-calendar payout rows: only the manual / legacy slice is
  -- replaceable.
  delete from public.hh_payout_charges
  where svc_key = p_svc_key
    and coalesce(remarks, '') not like 'duty:%';

  insert into public.hh_payout_charges (
    svc_key, date, partner, term, amount, remarks
  )
  select
    p_svc_key,
    coalesce(x.date, ''),
    coalesce(x.partner, ''),
    coalesce(x.term, ''),
    coalesce(x.amount, 0),
    coalesce(x.remarks, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    svc_key text,
    date text,
    partner text,
    term text,
    amount numeric,
    remarks text
  )
  -- Reject any attempt to inject a duty-calendar payout row through this path.
  where coalesce(x.remarks, '') not like 'duty:%';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.hominal_replace_service_entries(text, jsonb) to authenticated;
grant execute on function public.hominal_replace_payout_charges(text, jsonb) to authenticated;

commit;
