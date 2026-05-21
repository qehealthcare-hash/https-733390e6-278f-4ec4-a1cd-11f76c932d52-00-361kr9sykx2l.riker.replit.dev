-- Normalized permission catalog + role grants (mirrors apps/api/src/lib/permissions.js).
-- Used for admin reporting / future dynamic RBAC; API middleware may still use JS map.

create table if not exists public.crm_permissions (
  code text primary key,
  description text not null default '',
  module text not null default 'general',
  created_at timestamptz not null default now()
);

create table if not exists public.crm_role_permission_grants (
  role text not null check (role in ('ADMIN', 'STAFF', 'ACCOUNTANT', 'NURSE', 'ATTENDANT')),
  permission_code text not null references public.crm_permissions(code) on delete cascade,
  primary key (role, permission_code)
);

create index if not exists idx_crm_role_perm_role on public.crm_role_permission_grants (role);

alter table public.crm_permissions enable row level security;
alter table public.crm_role_permission_grants enable row level security;

create policy "authenticated read crm_permissions" on public.crm_permissions
for select using (auth.role() = 'authenticated');

create policy "authenticated read role grants" on public.crm_role_permission_grants
for select using (auth.role() = 'authenticated');

create policy "admin manage crm_permissions" on public.crm_permissions
for all using (public.current_user_role() = 'ADMIN')
with check (public.current_user_role() = 'ADMIN');

create policy "admin manage role grants" on public.crm_role_permission_grants
for all using (public.current_user_role() = 'ADMIN')
with check (public.current_user_role() = 'ADMIN');

insert into public.crm_permissions (code, description, module) values
  ('*', 'Full access', 'admin'),
  ('dashboard.read', 'View dashboard', 'dashboard'),
  ('employees.read', 'View employees', 'employees'),
  ('employees.write', 'Create/update employees', 'employees'),
  ('patients.read', 'View patients', 'patients'),
  ('patients.write', 'Create/update patients', 'patients'),
  ('inquiries.read', 'View inquiries', 'inquiries'),
  ('inquiries.write', 'Create/update inquiries', 'inquiries'),
  ('billings.read', 'View billing', 'billings'),
  ('billings.write', 'Create receipts / billing actions', 'billings'),
  ('payouts.read', 'View payouts', 'payouts'),
  ('payouts.write', 'Process payouts', 'payouts'),
  ('reports.read', 'View reports', 'reports'),
  ('self.read', 'View own profile', 'self'),
  ('doctors.read', 'View doctors', 'doctors'),
  ('doctors.write', 'Manage doctors', 'doctors'),
  ('vendors.read', 'View vendors', 'vendors'),
  ('vendors.write', 'Manage vendors', 'vendors'),
  ('settings.read', 'View app settings', 'settings'),
  ('settings.write', 'Update app settings', 'settings'),
  ('catalog.read', 'View service catalog', 'services')
on conflict (code) do nothing;

-- ADMIN: *
insert into public.crm_role_permission_grants (role, permission_code)
select 'ADMIN', code from public.crm_permissions where code = '*'
on conflict do nothing;

-- STAFF
insert into public.crm_role_permission_grants (role, permission_code) values
  ('STAFF', 'dashboard.read'),
  ('STAFF', 'employees.read'),
  ('STAFF', 'employees.write'),
  ('STAFF', 'patients.read'),
  ('STAFF', 'patients.write'),
  ('STAFF', 'inquiries.read'),
  ('STAFF', 'inquiries.write'),
  ('STAFF', 'billings.read'),
  ('STAFF', 'billings.write'),
  ('STAFF', 'reports.read'),
  ('STAFF', 'doctors.read'),
  ('STAFF', 'doctors.write'),
  ('STAFF', 'vendors.read'),
  ('STAFF', 'vendors.write'),
  ('STAFF', 'catalog.read'),
  ('STAFF', 'settings.read')
on conflict do nothing;

-- ACCOUNTANT
insert into public.crm_role_permission_grants (role, permission_code) values
  ('ACCOUNTANT', 'dashboard.read'),
  ('ACCOUNTANT', 'employees.read'),
  ('ACCOUNTANT', 'patients.read'),
  ('ACCOUNTANT', 'billings.read'),
  ('ACCOUNTANT', 'billings.write'),
  ('ACCOUNTANT', 'payouts.read'),
  ('ACCOUNTANT', 'payouts.write'),
  ('ACCOUNTANT', 'reports.read'),
  ('ACCOUNTANT', 'vendors.read'),
  ('ACCOUNTANT', 'catalog.read'),
  ('ACCOUNTANT', 'settings.read')
on conflict do nothing;

-- NURSE / ATTENDANT
insert into public.crm_role_permission_grants (role, permission_code) values
  ('NURSE', 'dashboard.read'),
  ('NURSE', 'employees.read'),
  ('NURSE', 'patients.read'),
  ('NURSE', 'payouts.read'),
  ('NURSE', 'self.read'),
  ('NURSE', 'catalog.read'),
  ('ATTENDANT', 'dashboard.read'),
  ('ATTENDANT', 'employees.read'),
  ('ATTENDANT', 'patients.read'),
  ('ATTENDANT', 'payouts.read'),
  ('ATTENDANT', 'self.read'),
  ('ATTENDANT', 'catalog.read')
on conflict do nothing;
