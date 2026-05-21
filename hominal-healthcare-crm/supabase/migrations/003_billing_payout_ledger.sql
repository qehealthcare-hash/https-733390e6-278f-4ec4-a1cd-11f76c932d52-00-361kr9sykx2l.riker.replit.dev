create table if not exists public.patient_services (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_name text not null,
  service_date date not null,
  duration_label text,
  total_people integer not null default 1 check (total_people > 0),
  daily_rate numeric(12,2) not null default 0 check (daily_rate >= 0),
  assigned_staff_id uuid references public.employees(id) on delete set null,
  billing_status text not null default 'UNPAID' check (billing_status in ('UNPAID', 'PAID')),
  payout_status text not null default 'UNPAID' check (payout_status in ('UNPAID', 'PAID')),
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  receipt_no text not null default ('BRC' || to_char(now(), 'YYYYMMDDHH24MISSMS')),
  transaction_type text not null default 'PAYMENT',
  service_name text,
  bill_mode text not null default 'MONTHLY' check (bill_mode in ('MONTHLY', 'CUSTOM')),
  from_date date,
  to_date date,
  paid_days integer not null default 0 check (paid_days >= 0),
  paid_service_dates date[] not null default '{}'::date[],
  amount numeric(12,2) not null default 0 check (amount >= 0),
  payment_mode public.payment_mode not null,
  received_on date not null,
  invoice_reference text,
  note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_payouts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  payout_no text not null default ('SFP' || to_char(now(), 'YYYYMMDDHH24MISSMS')),
  service_name text,
  payout_option text not null default 'MONTHLY' check (payout_option in ('MONTHLY', 'CUSTOM', 'PARTIAL')),
  payout_month date,
  from_date date,
  to_date date,
  paid_days integer not null default 0 check (paid_days >= 0),
  paid_work_dates date[] not null default '{}'::date[],
  payable_amount numeric(12,2) not null default 0 check (payable_amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(12,2) not null default 0 check (balance_amount >= 0),
  payment_mode public.payment_mode,
  proof_file_path text,
  note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_services
  add column if not exists receipt_id uuid,
  add column if not exists staff_payout_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patient_services_receipt_id_fkey'
  ) then
    alter table public.patient_services
      add constraint patient_services_receipt_id_fkey
      foreign key (receipt_id) references public.billing_receipts(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'patient_services_staff_payout_id_fkey'
  ) then
    alter table public.patient_services
      add constraint patient_services_staff_payout_id_fkey
      foreign key (staff_payout_id) references public.staff_payouts(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_patient_services_updated_at') then
    create trigger trg_patient_services_updated_at before update on public.patient_services for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_billing_receipts_updated_at') then
    create trigger trg_billing_receipts_updated_at before update on public.billing_receipts for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_payouts_updated_at') then
    create trigger trg_staff_payouts_updated_at before update on public.staff_payouts for each row execute function public.set_updated_at();
  end if;
end $$;

create index if not exists idx_patient_services_invoice_date on public.patient_services(invoice_id, service_date);
create index if not exists idx_patient_services_patient_date on public.patient_services(patient_id, service_date);
create index if not exists idx_patient_services_billing_status on public.patient_services(billing_status);
create index if not exists idx_patient_services_payout_status on public.patient_services(payout_status);
create index if not exists idx_patient_services_assigned_staff on public.patient_services(assigned_staff_id, service_date);
create index if not exists idx_billing_receipts_invoice_active on public.billing_receipts(invoice_id, deleted_at, created_at desc);
create index if not exists idx_staff_payouts_employee_active on public.staff_payouts(employee_id, deleted_at, created_at desc);

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

  v_outstanding := greatest(0, v_total_service_amount - v_paid_service_amount - coalesce(v_invoice.security_deposit, 0));

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

create or replace function public.create_staff_payout(
  p_employee_id uuid,
  p_patient_id uuid,
  p_invoice_id uuid,
  p_service_name text,
  p_payout_option text,
  p_payout_month date,
  p_from_date date,
  p_to_date date,
  p_paid_work_dates date[],
  p_paid_days integer,
  p_payable_amount numeric,
  p_paid_amount numeric,
  p_payment_mode public.payment_mode,
  p_proof_file_path text,
  p_note text,
  p_actor_user_id uuid
)
returns public.staff_payouts
language plpgsql
as $$
declare
  v_payout public.staff_payouts%rowtype;
  v_work_dates date[] := '{}'::date[];
  v_service_name text := nullif(trim(coalesce(p_service_name, '')), '');
begin
  if coalesce(array_length(p_paid_work_dates, 1), 0) > 0 then
    select coalesce(array_agg(ps.service_date order by ps.service_date), '{}'::date[])
    into v_work_dates
    from public.patient_services ps
    where ps.assigned_staff_id = p_employee_id
      and ps.deleted_at is null
      and ps.payout_status = 'UNPAID'
      and (p_patient_id is null or ps.patient_id = p_patient_id)
      and (p_invoice_id is null or ps.invoice_id = p_invoice_id)
      and (v_service_name is null or ps.service_name = v_service_name)
      and ps.service_date = any(p_paid_work_dates);
  else
    if p_from_date is null or p_to_date is null then
      raise exception 'From Date and To Date are required for payout';
    end if;

    select coalesce(array_agg(ps.service_date order by ps.service_date), '{}'::date[])
    into v_work_dates
    from public.patient_services ps
    where ps.assigned_staff_id = p_employee_id
      and ps.deleted_at is null
      and ps.payout_status = 'UNPAID'
      and (p_patient_id is null or ps.patient_id = p_patient_id)
      and (p_invoice_id is null or ps.invoice_id = p_invoice_id)
      and (v_service_name is null or ps.service_name = v_service_name)
      and ps.service_date between p_from_date and p_to_date;
  end if;

  if coalesce(array_length(v_work_dates, 1), 0) = 0 then
    raise exception 'No unpaid work dates found for payout';
  end if;

  insert into public.staff_payouts (
    employee_id,
    patient_id,
    invoice_id,
    service_name,
    payout_option,
    payout_month,
    from_date,
    to_date,
    paid_days,
    paid_work_dates,
    payable_amount,
    paid_amount,
    balance_amount,
    payment_mode,
    proof_file_path,
    note,
    created_by
  )
  values (
    p_employee_id,
    p_patient_id,
    p_invoice_id,
    v_service_name,
    coalesce(p_payout_option, 'MONTHLY'),
    p_payout_month,
    v_work_dates[1],
    v_work_dates[array_length(v_work_dates, 1)],
    coalesce(array_length(v_work_dates, 1), 0),
    v_work_dates,
    greatest(coalesce(p_payable_amount, 0), 0),
    greatest(coalesce(p_paid_amount, 0), 0),
    greatest(coalesce(p_payable_amount, 0) - coalesce(p_paid_amount, 0), 0),
    p_payment_mode,
    p_proof_file_path,
    coalesce(p_note, ''),
    p_actor_user_id
  )
  returning * into v_payout;

  update public.patient_services
  set
    payout_status = 'PAID',
    staff_payout_id = v_payout.id,
    updated_by = p_actor_user_id,
    updated_at = now()
  where assigned_staff_id = p_employee_id
    and deleted_at is null
    and payout_status = 'UNPAID'
    and service_date = any(v_work_dates)
    and (p_patient_id is null or patient_id = p_patient_id)
    and (p_invoice_id is null or invoice_id = p_invoice_id)
    and (v_service_name is null or service_name = v_service_name);

  insert into public.audit_logs (
    module_name,
    action_name,
    record_id,
    actor_user_id,
    actor_name,
    metadata
  )
  select
    'payouts',
    'payout_create',
    v_payout.id,
    au.id,
    au.full_name,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'patient_id', p_patient_id,
      'service_name', v_service_name,
      'paid_days', v_payout.paid_days,
      'payable_amount', v_payout.payable_amount,
      'paid_amount', v_payout.paid_amount
    )
  from public.app_users au
  where au.id = p_actor_user_id;

  return v_payout;
end;
$$;

create or replace function public.soft_delete_staff_payout(
  p_payout_id uuid,
  p_actor_user_id uuid
)
returns public.staff_payouts
language plpgsql
as $$
declare
  v_payout public.staff_payouts%rowtype;
begin
  select * into v_payout
  from public.staff_payouts
  where id = p_payout_id
    and deleted_at is null;

  if not found then
    raise exception 'Payout % not found or already deleted', p_payout_id;
  end if;

  update public.staff_payouts
  set
    deleted_at = now(),
    deleted_by = p_actor_user_id,
    updated_at = now()
  where id = p_payout_id
  returning * into v_payout;

  update public.patient_services
  set
    payout_status = 'UNPAID',
    staff_payout_id = null,
    updated_by = p_actor_user_id,
    updated_at = now()
  where staff_payout_id = p_payout_id;

  insert into public.audit_logs (
    module_name,
    action_name,
    record_id,
    actor_user_id,
    actor_name,
    metadata
  )
  select
    'payouts',
    'payout_delete',
    v_payout.id,
    au.id,
    au.full_name,
    jsonb_build_object(
      'employee_id', v_payout.employee_id,
      'patient_id', v_payout.patient_id,
      'service_name', v_payout.service_name,
      'paid_amount', v_payout.paid_amount
    )
  from public.app_users au
  where au.id = p_actor_user_id;

  return v_payout;
end;
$$;
