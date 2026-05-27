-- m12 — public registration counts + Realtime-friendly stats row per exam

create table public.exam_public_stats (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  registration_count int not null default 0 check (registration_count >= 0),
  question_count int not null default 0 check (question_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.exam_public_stats enable row level security;

create policy "exam_public_stats_select_all"
  on public.exam_public_stats
  for select
  using (true);

create policy "exam_public_stats_no_client_write"
  on public.exam_public_stats
  for all
  using (false);

-- Create stats row when an exam is created
create or replace function public.ensure_exam_public_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exam_public_stats (exam_id, registration_count, question_count)
  values (new.id, 0, 0)
  on conflict (exam_id) do nothing;
  return new;
end;
$$;

drop trigger if exists exams_ensure_public_stats on public.exams;
create trigger exams_ensure_public_stats
  after insert on public.exams
  for each row execute function public.ensure_exam_public_stats();

-- Bump count when a student registers
create or replace function public.bump_exam_registration_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exam_public_stats (exam_id, registration_count, updated_at)
  values (new.exam_id, 1, now())
  on conflict (exam_id) do update
  set registration_count = public.exam_public_stats.registration_count + 1,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists exam_registrations_bump_stats on public.exam_registrations;
create trigger exam_registrations_bump_stats
  after insert on public.exam_registrations
  for each row execute function public.bump_exam_registration_count();

-- Keep question_count in sync (RLS blocks anon reads on exam_questions)
create or replace function public.sync_exam_question_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_exam_id uuid;
begin
  target_exam_id := coalesce(new.exam_id, old.exam_id);
  insert into public.exam_public_stats (exam_id, registration_count, question_count)
  values (
    target_exam_id,
    0,
    (select count(*)::int from public.exam_questions where exam_id = target_exam_id)
  )
  on conflict (exam_id) do update
  set question_count = excluded.question_count,
      updated_at = now();
  return coalesce(new, old);
end;
$$;

drop trigger if exists exam_questions_sync_stats on public.exam_questions;
create trigger exam_questions_sync_stats
  after insert or delete or update of exam_id on public.exam_questions
  for each row execute function public.sync_exam_question_count();

-- Backfill stats for existing exams
insert into public.exam_public_stats (exam_id, registration_count, question_count)
select
  e.id,
  coalesce(count(distinct r.id), 0)::int,
  coalesce(count(distinct q.id), 0)::int
from public.exams e
left join public.exam_registrations r on r.exam_id = e.id
left join public.exam_questions q on q.exam_id = e.id
group by e.id
on conflict (exam_id) do update
set registration_count = excluded.registration_count,
    question_count = excluded.question_count,
    updated_at = now();

-- Realtime (Supabase: table must be in publication)
alter table public.exam_public_stats replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'exam_public_stats'
  ) then
    alter publication supabase_realtime add table public.exam_public_stats;
  end if;
exception
  when others then null;
end $$;
