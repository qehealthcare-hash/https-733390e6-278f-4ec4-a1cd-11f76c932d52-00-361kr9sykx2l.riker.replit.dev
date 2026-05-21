do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'patients'
  ) then
    alter table public.patients
      add column if not exists address text;

    alter table public.patients
      alter column address drop not null;

    alter table public.patients
      add column if not exists registered_at timestamptz;

    update public.patients
    set registered_at = coalesce(registered_at, created_at, now())
    where registered_at is null;

    alter table public.patients
      alter column registered_at set default now();

    alter table public.patients
      alter column registered_at set not null;

    create index if not exists idx_registered_at on public.patients(registered_at);
  elsif exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'hh_patients'
  ) then
    alter table public.hh_patients
      add column if not exists registered_at timestamptz;

    update public.hh_patients
    set registered_at = coalesce(registered_at, created_at, now())
    where registered_at is null;

    alter table public.hh_patients
      alter column registered_at set default now();

    create index if not exists hh_patients_registered_at_idx on public.hh_patients(registered_at);
  else
    raise notice 'No patients table found in public schema.';
  end if;
end $$;
