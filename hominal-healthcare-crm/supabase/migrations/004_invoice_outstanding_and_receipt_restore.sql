-- Align outstanding calculation with application rules: security deposit only
-- credits the patient balance once the invoice is final or closed.
create or replace function public.recalculate_invoice_outstanding(p_invoice_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_total_service_amount numeric(12,2) := 0;
  v_paid_service_amount numeric(12,2) := 0;
  v_total_service_days integer := 0;
  v_paid_service_days integer := 0;
  v_outstanding numeric(12,2) := 0;
  v_deposit_credit numeric(12,2) := 0;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  select
    coalesce(sum(ps.daily_rate * ps.total_people), 0),
    count(*)
  into
    v_total_service_amount,
    v_total_service_days
  from public.patient_services ps
  where ps.invoice_id = p_invoice_id
    and ps.deleted_at is null;

  if v_total_service_days = 0 then
    v_total_service_amount := coalesce(v_invoice.subtotal_amount, 0);
  end if;

  select
    coalesce(sum(br.amount), 0),
    coalesce(sum(br.paid_days), 0)
  into
    v_paid_service_amount,
    v_paid_service_days
  from public.billing_receipts br
  where br.invoice_id = p_invoice_id
    and br.deleted_at is null
    and coalesce(br.transaction_type, 'PAYMENT') <> 'SECURITY';

  if v_invoice.invoice_type = 'FINAL' or v_invoice.status = 'CLOSED' then
    v_deposit_credit := coalesce(v_invoice.security_deposit, 0);
  else
    v_deposit_credit := 0;
  end if;

  v_outstanding := greatest(0, v_total_service_amount - v_paid_service_amount - v_deposit_credit);

  update public.invoices
  set
    subtotal_amount = v_total_service_amount,
    outstanding_amount = v_outstanding,
    updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'total_service_amount', v_total_service_amount,
    'paid_service_amount', v_paid_service_amount,
    'total_service_days', v_total_service_days,
    'paid_service_days', v_paid_service_days,
    'unpaid_service_days', greatest(0, v_total_service_days - v_paid_service_days),
    'outstanding_amount', v_outstanding
  );
end;
$$;

-- Restore a soft-deleted billing receipt and re-link paid service days.
create or replace function public.restore_billing_receipt(
  p_receipt_id uuid,
  p_actor_user_id uuid
)
returns public.billing_receipts
language plpgsql
as $$
declare
  v_receipt public.billing_receipts%rowtype;
begin
  select * into v_receipt
  from public.billing_receipts
  where id = p_receipt_id
    and deleted_at is not null;

  if not found then
    raise exception 'Receipt % not found or not deleted', p_receipt_id;
  end if;

  if coalesce(v_receipt.transaction_type, 'PAYMENT') = 'SECURITY' then
    update public.billing_receipts
    set
      deleted_at = null,
      deleted_by = null,
      updated_at = now()
    where id = p_receipt_id
    returning * into v_receipt;

    perform public.recalculate_invoice_outstanding(v_receipt.invoice_id);
    return v_receipt;
  end if;

  update public.billing_receipts
  set
    deleted_at = null,
    deleted_by = null,
    updated_at = now()
  where id = p_receipt_id
  returning * into v_receipt;

  update public.patient_services ps
  set
    billing_status = 'PAID',
    receipt_id = v_receipt.id,
    updated_by = p_actor_user_id,
    updated_at = now()
  from public.billing_receipts br
  where br.id = v_receipt.id
    and ps.invoice_id = br.invoice_id
    and ps.deleted_at is null
    and ps.service_name = br.service_name
    and ps.service_date = any(br.paid_service_dates)
    and ps.billing_status = 'UNPAID';

  insert into public.audit_logs (
    module_name,
    action_name,
    record_id,
    actor_user_id,
    actor_name,
    metadata
  )
  select
    'billings',
    'receipt_restore',
    v_receipt.id,
    au.id,
    au.full_name,
    jsonb_build_object(
      'invoice_id', v_receipt.invoice_id,
      'service_name', v_receipt.service_name,
      'amount', v_receipt.amount
    )
  from public.app_users au
  where au.id = p_actor_user_id;

  perform public.recalculate_invoice_outstanding(v_receipt.invoice_id);
  return v_receipt;
end;
$$;
