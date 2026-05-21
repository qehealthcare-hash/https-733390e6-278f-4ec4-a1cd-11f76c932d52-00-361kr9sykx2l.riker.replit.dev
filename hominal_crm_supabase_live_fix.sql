begin;

create or replace function public.hh_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.hh_users add column if not exists phone text default '';
alter table public.hh_users add column if not exists role text default '';
alter table public.hh_users add column if not exists password text default 'admin123';
alter table public.hh_users add column if not exists is_active boolean not null default true;
alter table public.hh_users add column if not exists created text default '';

alter table public.hh_employees add column if not exists docs jsonb not null default '[]'::jsonb;

alter table public.hh_patients add column if not exists photo jsonb;
alter table public.hh_patients add column if not exists docs jsonb not null default '[]'::jsonb;

alter table public.hh_counters add column if not exists created_at timestamptz not null default now();
alter table public.hh_counters add column if not exists updated_at timestamptz not null default now();

create table if not exists public.hh_inquiries (
  id text primary key,
  name text not null default '',
  phone text default '',
  wa text default '',
  age text default '',
  gender text default '',
  city text default '',
  area text default '',
  service text default '',
  source text default '',
  potential text default 'Warm',
  rating_emergency integer default 5,
  rating_flexibility integer default 5,
  rating_overall integer default 5,
  status text default 'New',
  assigned_to text default '',
  followup_date text default '',
  notes text default '',
  created text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on table public.hh_inquiries to anon, authenticated;

alter table public.hh_inquiries enable row level security;
drop policy if exists hh_inquiries_public_access on public.hh_inquiries;
create policy hh_inquiries_public_access on public.hh_inquiries
for all to anon, authenticated
using (true) with check (true);

drop trigger if exists hh_inquiries_updated_at on public.hh_inquiries;
create trigger hh_inquiries_updated_at
before update on public.hh_inquiries
for each row execute function public.hh_set_updated_at();

insert into public.hh_counters (key, value)
values ('inq', 1)
on conflict (key) do update set value = excluded.value;

commit;
