-- Phase 4 — Hominal CRM API modules (Inquiry, Patient, Duty, Billing, Payout, AI, WhatsApp)
-- SAFE / ADDITIVE ONLY. No drops, no truncates. Run AFTER 011_phase3_rls_rpc.sql.
--
-- Apply in Supabase Dashboard → SQL Editor → New Query → Paste → Run.
-- Idempotent: safe to re-run.

begin;

-- ── A) Role/permission helpers (read JWT email → role from hh_users) ────────
create or replace function public.hh_current_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(u.role, '')
  from public.hh_users u
  where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(u.is_active, false) = true
  limit 1
$$;

create or replace function public.hh_has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.hh_users u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and coalesce(u.is_active, false) = true
      and lower(coalesce(u.role, '')) = any (
        select lower(unnest(required_roles))
      )
  )
$$;

create or replace function public.hh_current_actor()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
    'system'
  )
$$;

grant execute on function public.hh_current_role() to authenticated;
grant execute on function public.hh_has_role(text[]) to authenticated;
grant execute on function public.hh_current_actor() to authenticated, anon;

-- ── B) Audit columns on existing tables (no data loss) ──────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'hh_inquiries','hh_patients','hh_billings','hh_receipts',
    'hh_svc_entries','hh_payout_charges','hh_paid_transactions',
    'hh_employees','hh_doctors','hh_vendors','hh_users','hh_roles'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists created_by text', t);
      execute format('alter table public.%I add column if not exists updated_by text', t);
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- ── C) Generic audit trigger (writes to hh_audit_logs) ──────────────────────
create table if not exists public.hh_audit_logs (
  id bigserial primary key,
  module text not null,
  entity_id text,
  action text not null,
  stamp text,
  actor text,
  before jsonb,
  after jsonb,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.hh_audit_logs
  add column if not exists actor text,
  add column if not exists before jsonb,
  add column if not exists after jsonb;

create index if not exists idx_hh_audit_logs_module on public.hh_audit_logs (module, created_at desc);
create index if not exists idx_hh_audit_logs_entity on public.hh_audit_logs (entity_id);

create or replace function public.hh_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_module text := tg_argv[0];
  v_entity text;
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  v_action := lower(tg_op);
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
    new.created_by := coalesce(new.created_by, public.hh_current_actor());
    new.updated_by := coalesce(new.updated_by, public.hh_current_actor());
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_entity := coalesce(new.id::text, '');
    new.updated_by := public.hh_current_actor();
    new.updated_at := now();
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_entity := coalesce(old.id::text, '');
  end if;
  insert into public.hh_audit_logs(module, entity_id, action, actor, before, after, stamp)
  values (v_module, v_entity, v_action, public.hh_current_actor(), v_before, v_after, now()::text);
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

do $$
declare
  cfg record;
begin
  for cfg in (
    select * from (values
      ('hh_inquiries','inquiry'),
      ('hh_patients','patient'),
      ('hh_billings','billing'),
      ('hh_receipts','receipt'),
      ('hh_svc_entries','svc_entry'),
      ('hh_payout_charges','payout_charge'),
      ('hh_paid_transactions','paid_transaction'),
      ('hh_employees','employee'),
      ('hh_doctors','doctor'),
      ('hh_vendors','vendor'),
      ('hh_users','user'),
      ('hh_roles','role')
    ) as v(table_name, module)
  )
  loop
    if to_regclass('public.' || cfg.table_name) is not null then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || cfg.table_name, cfg.table_name);
      execute format(
        'create trigger %I before insert or update or delete on public.%I for each row execute function public.hh_audit_trigger(%L)',
        'trg_audit_' || cfg.table_name, cfg.table_name, cfg.module
      );
    end if;
  end loop;
end $$;

-- ── D) New tables: Duty Calendar, Attendance, WhatsApp, AI ──────────────────
create table if not exists public.hh_duties (
  id text primary key,
  patient_id text references public.hh_patients(id) on delete set null,
  employee_id text references public.hh_employees(id) on delete set null,
  service_type text default '',
  shift_type text default 'DAY', -- DAY | NIGHT | 24H
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text default 'SCHEDULED', -- SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW
  cancel_reason text default '',
  notes text default '',
  billing_id text references public.hh_billings(id) on delete set null,
  payout_id text default null,
  created_by text default '',
  updated_by text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hh_duties_time_check check (end_at > start_at)
);

create index if not exists idx_hh_duties_patient on public.hh_duties (patient_id, start_at);
create index if not exists idx_hh_duties_employee on public.hh_duties (employee_id, start_at);
create index if not exists idx_hh_duties_billing on public.hh_duties (billing_id);
create index if not exists idx_hh_duties_status on public.hh_duties (status);
create index if not exists idx_hh_duties_range on public.hh_duties (employee_id, start_at, end_at);

create table if not exists public.hh_attendance (
  id text primary key,
  duty_id text references public.hh_duties(id) on delete cascade,
  employee_id text references public.hh_employees(id) on delete set null,
  patient_id text references public.hh_patients(id) on delete set null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  hours numeric default 0,
  status text default 'PRESENT', -- PRESENT | ABSENT | LATE | HALF
  remarks text default '',
  created_by text default '',
  updated_by text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hh_attendance_employee on public.hh_attendance (employee_id, check_in_at);
create index if not exists idx_hh_attendance_duty on public.hh_attendance (duty_id);

create table if not exists public.hh_payouts (
  id text primary key,
  employee_id text references public.hh_employees(id) on delete set null,
  period_month text not null, -- 'YYYY-MM'
  gross_amount numeric default 0,
  duty_count integer default 0,
  hours numeric default 0,
  advance numeric default 0,
  deduction numeric default 0,
  bonus numeric default 0,
  net_amount numeric default 0,
  status text default 'OPEN', -- OPEN | LOCKED | PAID
  paid_at timestamptz,
  remarks text default '',
  created_by text default '',
  updated_by text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hh_payouts_unique unique (employee_id, period_month)
);

create index if not exists idx_hh_payouts_period on public.hh_payouts (period_month);
create index if not exists idx_hh_payouts_employee on public.hh_payouts (employee_id);

create table if not exists public.hh_whatsapp_messages (
  id text primary key,
  direction text default 'OUT', -- IN | OUT
  template text default '',
  to_number text default '',
  from_number text default '',
  related_module text default '', -- inquiry | billing | duty | patient
  related_id text default '',
  payload jsonb default '{}'::jsonb,
  status text default 'QUEUED', -- QUEUED | SENT | DELIVERED | READ | FAILED
  provider_message_id text default '',
  error text default '',
  sent_at timestamptz,
  created_by text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hh_whatsapp_status on public.hh_whatsapp_messages (status, created_at desc);
create index if not exists idx_hh_whatsapp_related on public.hh_whatsapp_messages (related_module, related_id);

create table if not exists public.hh_ai_conversations (
  id text primary key,
  actor text default '',
  title text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hh_ai_messages (
  id text primary key,
  conversation_id text references public.hh_ai_conversations(id) on delete cascade,
  role text default 'user', -- user | assistant | system | tool
  content text default '',
  tool_calls jsonb default '[]'::jsonb,
  citations jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hh_ai_messages_conv on public.hh_ai_messages (conversation_id, created_at);

-- ── E) Dedupe / integrity ───────────────────────────────────────────────────
create unique index if not exists uq_hh_inquiries_phone_active
  on public.hh_inquiries (lower(coalesce(phone,'')))
  where coalesce(status,'') not in ('Converted','Closed','Lost');

create unique index if not exists uq_hh_billings_patient_active
  on public.hh_billings (patient_id)
  where coalesce(status,'Active') = 'Active';

create unique index if not exists uq_hh_attendance_per_duty on public.hh_attendance (duty_id);

-- Prevent overlapping non-cancelled duties for the same employee using exclusion constraint.
create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hh_duties_no_overlap'
  ) then
    alter table public.hh_duties
      add constraint hh_duties_no_overlap exclude using gist (
        employee_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      ) where (status not in ('CANCELLED','NO_SHOW'));
  end if;
end $$;

-- ── F) RLS (only active app users; role-based writes for sensitive modules) ─
alter table if exists public.hh_duties enable row level security;
alter table if exists public.hh_attendance enable row level security;
alter table if exists public.hh_payouts enable row level security;
alter table if exists public.hh_whatsapp_messages enable row level security;
alter table if exists public.hh_ai_conversations enable row level security;
alter table if exists public.hh_ai_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'hh_duties','hh_attendance','hh_payouts',
    'hh_whatsapp_messages','hh_ai_conversations','hh_ai_messages'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_auth_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.hh_is_active_app_user())',
      t || '_auth_read', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.hh_is_active_app_user()) with check (public.hh_is_active_app_user())',
      t || '_auth_write', t
    );
  end loop;
end $$;

-- Lock down payout edits to Admin/Accountant/Manager only (idempotent on re-run)
drop policy if exists hh_payouts_auth_write on public.hh_payouts;
drop policy if exists hh_payouts_role_write on public.hh_payouts;
create policy hh_payouts_role_write on public.hh_payouts
  for all to authenticated
  using (public.hh_has_role(array['Admin','Accountant','Manager']))
  with check (public.hh_has_role(array['Admin','Accountant','Manager']));

-- ── G) Realtime ─────────────────────────────────────────────────────────────
alter table if exists public.hh_duties replica identity full;
alter table if exists public.hh_attendance replica identity full;
alter table if exists public.hh_payouts replica identity full;
alter table if exists public.hh_whatsapp_messages replica identity full;

do $$
declare t text;
begin
  foreach t in array array[
    'hh_duties','hh_attendance','hh_payouts','hh_whatsapp_messages'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── H) Convert-inquiry-to-patient RPC ───────────────────────────────────────
create or replace function public.hh_convert_inquiry_to_patient(p_inquiry_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inq public.hh_inquiries%rowtype;
  v_pat public.hh_patients%rowtype;
  v_new_id text;
begin
  select * into v_inq from public.hh_inquiries where id = p_inquiry_id;
  if not found then raise exception 'inquiry % not found', p_inquiry_id; end if;

  select * into v_pat
  from public.hh_patients
  where coalesce(phone,'') <> '' and lower(coalesce(phone,'')) = lower(coalesce(v_inq.phone,''))
  limit 1;

  if found then
    v_new_id := v_pat.id;
  else
    v_new_id := 'P' || to_char(now(), 'YYMMDD') || lpad((floor(random()*9999))::int::text, 4, '0');
    insert into public.hh_patients (
      id, name, phone, addr, area, city, status, created, created_at, updated_at, created_by, updated_by
    ) values (
      v_new_id,
      coalesce(v_inq.name, ''),
      coalesce(v_inq.phone, ''),
      coalesce(v_inq.address, ''),
      coalesce(v_inq.area, ''),
      coalesce(v_inq.city, 'Ahmedabad'),
      'Active',
      to_char(now(), 'DD Mon YYYY'),
      now(),
      now(),
      public.hh_current_actor(),
      public.hh_current_actor()
    );
  end if;

  update public.hh_inquiries
  set status = 'Converted',
      assigned_to = coalesce(assigned_to, ''),
      notes = coalesce(notes, ''),
      updated_by = public.hh_current_actor(),
      updated_at = now()
  where id = p_inquiry_id;

  return jsonb_build_object('patient_id', v_new_id, 'inquiry_id', p_inquiry_id);
end;
$$;

grant execute on function public.hh_convert_inquiry_to_patient(text) to authenticated;

-- ── I) Duty → Billing sync helper ───────────────────────────────────────────
create or replace function public.hh_billing_amount_for_shift(p_shift text, p_day_rate numeric, p_night_rate numeric, p_full_rate numeric)
returns numeric
language sql
immutable
as $$
  select case upper(coalesce(p_shift,''))
    when 'NIGHT' then coalesce(p_night_rate, 0)
    when '24H' then coalesce(p_full_rate, p_day_rate + p_night_rate, 0)
    when 'FULL' then coalesce(p_full_rate, p_day_rate + p_night_rate, 0)
    else coalesce(p_day_rate, 0)
  end
$$;

-- ── J) Payout aggregation helper ────────────────────────────────────────────
create or replace function public.hh_recompute_payout(p_employee_id text, p_period text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_hours numeric := 0;
  v_count integer := 0;
  v_gross numeric := 0;
  v_existing public.hh_payouts%rowtype;
begin
  if p_employee_id is null or p_period is null then
    raise exception 'employee_id and period are required';
  end if;

  select count(*), coalesce(sum(hours), 0)
  into v_count, v_hours
  from public.hh_attendance a
  where a.employee_id = p_employee_id
    and to_char(coalesce(a.check_in_at, now()), 'YYYY-MM') = p_period
    and a.status = 'PRESENT';

  select coalesce(sum(amount), 0)
  into v_gross
  from public.hh_payout_charges
  where coalesce(remarks,'') ilike '%' || p_employee_id || '%'
    and to_char(coalesce(created_at, now()), 'YYYY-MM') = p_period;

  select * into v_existing
  from public.hh_payouts
  where employee_id = p_employee_id and period_month = p_period;

  if found then
    update public.hh_payouts
    set gross_amount = v_gross,
        duty_count = v_count,
        hours = v_hours,
        net_amount = v_gross + coalesce(bonus,0) - coalesce(advance,0) - coalesce(deduction,0),
        updated_by = public.hh_current_actor(),
        updated_at = now()
    where employee_id = p_employee_id and period_month = p_period
    returning id into v_id;
  else
    v_id := 'PO' || to_char(now(), 'YYMMDD') || lpad((floor(random()*99999))::int::text, 5, '0');
    insert into public.hh_payouts (id, employee_id, period_month, gross_amount, duty_count, hours, net_amount, created_by, updated_by)
    values (v_id, p_employee_id, p_period, v_gross, v_count, v_hours, v_gross, public.hh_current_actor(), public.hh_current_actor());
  end if;

  return jsonb_build_object('payout_id', v_id, 'gross', v_gross, 'duties', v_count, 'hours', v_hours);
end;
$$;

grant execute on function public.hh_recompute_payout(text, text) to authenticated;

commit;
