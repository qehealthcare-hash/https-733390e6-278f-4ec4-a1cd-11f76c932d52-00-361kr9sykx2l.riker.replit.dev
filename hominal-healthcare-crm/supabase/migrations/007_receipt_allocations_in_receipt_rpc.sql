-- Wire receipt_service_allocations into create_billing_receipt / soft_delete_billing_receipt.
-- Requires 006 (receipt_service_allocations table).

create or replace function public.create_billing_receipt(
  p_invoice_id uuid,
  p_patient_id uuid,
  p_receipt_no text,
  p_transaction_type text,
  p_service_name text,
  p_bill_mode text,
  p_from_date date,
  p_to_date date,
  p_paid_days integer,
  p_paid_service_dates date[],
  p_amount numeric,
  p_payment_mode public.payment_mode,
  p_received_on date,
  p_invoice_reference text,
  p_note text,
  p_actor_user_id uuid
)
returns public.billing_receipts
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_paid_dates date[] := '{}'::date[];
  v_transaction_type text := upper(coalesce(p_transaction_type, 'PAYMENT'));
  v_service_name text := nullif(trim(coalesce(p_service_name, '')), '');
  v_from date := p_from_date;
  v_to date := p_to_date;
  v_receipt_no text := nullif(trim(coalesce(p_receipt_no, '')), '');
  v_amount numeric(12,2) := greatest(coalesce(p_amount, 0), 0);
  v_line_sum numeric(12,2);
  v_alloc_sum numeric(12,2);
  v_first_alloc_id uuid;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if v_receipt_no is null then
    v_receipt_no := 'BRC' || to_char(now(), 'YYYYMMDDHH24MISSMS');
  end if;

  if v_transaction_type <> 'SECURITY' then
    if v_service_name is null then
      raise exception 'Service type is required';
    end if;

    if v_from is null or v_to is null then
      raise exception 'From Date and To Date are required';
    end if;

    if v_from > v_to then
      raise exception 'From Date cannot be after To Date';
    end if;

    if coalesce(array_length(p_paid_service_dates, 1), 0) > 0 then
      select coalesce(array_agg(ps.service_date order by ps.service_date), '{}'::date[])
      into v_paid_dates
      from public.patient_services ps
      where ps.invoice_id = p_invoice_id
        and ps.deleted_at is null
        and ps.billing_status = 'UNPAID'
        and ps.service_name = v_service_name
        and ps.service_date = any(p_paid_service_dates);
    else
      select coalesce(array_agg(ps.service_date order by ps.service_date), '{}'::date[])
      into v_paid_dates
      from public.patient_services ps
      where ps.invoice_id = p_invoice_id
        and ps.deleted_at is null
        and ps.billing_status = 'UNPAID'
        and ps.service_name = v_service_name
        and ps.service_date between v_from and v_to;
    end if;

    if coalesce(array_length(v_paid_dates, 1), 0) = 0 then
      raise exception 'This date range is already paid.';
    end if;

    v_from := v_paid_dates[1];
    v_to := v_paid_dates[array_length(v_paid_dates, 1)];
  else
    v_paid_dates := '{}'::date[];
  end if;

  insert into public.billing_receipts (
    invoice_id,
    patient_id,
    receipt_no,
    transaction_type,
    service_name,
    bill_mode,
    from_date,
    to_date,
    paid_days,
    paid_service_dates,
    amount,
    payment_mode,
    received_on,
    invoice_reference,
    note,
    created_by
  )
  values (
    p_invoice_id,
    coalesce(p_patient_id, v_invoice.patient_id),
    v_receipt_no,
    v_transaction_type,
    v_service_name,
    coalesce(p_bill_mode, 'MONTHLY'),
    v_from,
    v_to,
    case
      when v_transaction_type = 'SECURITY' then greatest(coalesce(p_paid_days, 0), 0)
      else coalesce(array_length(v_paid_dates, 1), 0)
    end,
    v_paid_dates,
    v_amount,
    p_payment_mode,
    coalesce(p_received_on, current_date),
    p_invoice_reference,
    coalesce(p_note, ''),
    p_actor_user_id
  )
  returning * into v_receipt;

  if v_transaction_type <> 'SECURITY' and coalesce(array_length(v_paid_dates, 1), 0) > 0 then
    update public.patient_services
    set
      billing_status = 'PAID',
      receipt_id = v_receipt.id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where invoice_id = p_invoice_id
      and deleted_at is null
      and billing_status = 'UNPAID'
      and service_name = v_service_name
      and service_date = any(v_paid_dates);

    select coalesce(sum((ps.daily_rate * ps.total_people)::numeric), 0)
    into v_line_sum
    from public.patient_services ps
    where ps.receipt_id = v_receipt.id
      and ps.deleted_at is null;

    if v_line_sum > 0 and v_receipt.amount > 0 then
      insert into public.receipt_service_allocations (billing_receipt_id, patient_service_id, allocated_amount)
      select
        v_receipt.id,
        ps.id,
        round(v_receipt.amount::numeric * ((ps.daily_rate * ps.total_people)::numeric / v_line_sum), 2)
      from public.patient_services ps
      where ps.receipt_id = v_receipt.id
        and ps.deleted_at is null
      order by ps.service_date, ps.id;

      select coalesce(sum(allocated_amount), 0) into v_alloc_sum
      from public.receipt_service_allocations
      where billing_receipt_id = v_receipt.id;

      if v_alloc_sum <> v_receipt.amount then
        select id into v_first_alloc_id
        from public.receipt_service_allocations
        where billing_receipt_id = v_receipt.id
        order by patient_service_id
        limit 1;

        if v_first_alloc_id is not null then
          update public.receipt_service_allocations
          set allocated_amount = allocated_amount + (v_receipt.amount - v_alloc_sum)
          where id = v_first_alloc_id;
        end if;
      end if;
    elsif v_line_sum <= 0 and v_receipt.amount > 0 then
      insert into public.receipt_service_allocations (billing_receipt_id, patient_service_id, allocated_amount)
      with lines as (
        select ps.id
        from public.patient_services ps
        where ps.receipt_id = v_receipt.id and ps.deleted_at is null
      ),
      c as (select count(*)::numeric as n from lines)
      select v_receipt.id, l.id, round(v_receipt.amount / greatest(c.n, 1), 2)
      from lines l
      cross join c;

      select coalesce(sum(allocated_amount), 0) into v_alloc_sum
      from public.receipt_service_allocations
      where billing_receipt_id = v_receipt.id;

      if v_alloc_sum <> v_receipt.amount then
        select id into v_first_alloc_id
        from public.receipt_service_allocations
        where billing_receipt_id = v_receipt.id
        order by patient_service_id
        limit 1;

        if v_first_alloc_id is not null then
          update public.receipt_service_allocations
          set allocated_amount = allocated_amount + (v_receipt.amount - v_alloc_sum)
          where id = v_first_alloc_id;
        end if;
      end if;
    end if;
  end if;

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
    'receipt_create',
    v_receipt.id,
    au.id,
    au.full_name,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'service_name', v_service_name,
      'paid_days', v_receipt.paid_days,
      'amount', v_receipt.amount
    )
  from public.app_users au
  where au.id = p_actor_user_id;

  perform public.recalculate_invoice_outstanding(p_invoice_id);
  return v_receipt;
end;
$$;

create or replace function public.soft_delete_billing_receipt(
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
    and deleted_at is null;

  if not found then
    raise exception 'Receipt % not found or already deleted', p_receipt_id;
  end if;

  delete from public.receipt_service_allocations
  where billing_receipt_id = p_receipt_id;

  update public.billing_receipts
  set
    deleted_at = now(),
    deleted_by = p_actor_user_id,
    updated_at = now()
  where id = p_receipt_id
  returning * into v_receipt;

  update public.patient_services
  set
    billing_status = 'UNPAID',
    receipt_id = null,
    updated_by = p_actor_user_id,
    updated_at = now()
  where receipt_id = p_receipt_id;

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
    'receipt_delete',
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
