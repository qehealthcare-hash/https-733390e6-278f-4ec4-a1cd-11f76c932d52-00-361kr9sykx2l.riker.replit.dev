-- Maths Mania m9 — exam platform schema (§14.1)
-- Apply via: supabase db reset (local) or supabase migration up

-- ---------------------------------------------------------------------------
-- Helpers (role checks use profiles.role — never user_metadata in RLS)
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'anonymous'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'moderator');
$$;

-- ---------------------------------------------------------------------------
-- Profiles (extends auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  display_name text generated always as (
    split_part(full_name, ' ', 1) || ' ' ||
    left(split_part(full_name, ' ', -1), 1) || '.'
  ) stored,
  phone text,
  city text,
  state text,
  class_or_target text,
  role text not null default 'student'
    check (role in ('student', 'admin', 'moderator')),
  avatar_url text,
  whatsapp_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on public.profiles (role);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1),
      'Student'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Exams & questions
-- ---------------------------------------------------------------------------

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  pillar text not null
    check (pillar in ('school', 'banking', 'ssc', 'tricks', 'mixed')),
  difficulty text not null
    check (difficulty in ('easy', 'medium', 'hard')),
  duration_min int not null check (duration_min > 0),
  total_marks int not null check (total_marks > 0),
  marking_correct numeric not null default 1.0,
  marking_wrong numeric not null default -0.25,
  marking_skip numeric not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  registration_opens_at timestamptz not null,
  registration_closes_at timestamptz not null,
  merit_publish_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'live', 'closed', 'merit_published', 'archived')),
  syllabus jsonb,
  rules_md text,
  cover_image_url text,
  is_free boolean not null default true,
  price_inr int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_exams_status_starts on public.exams (status, starts_at);
create index idx_exams_slug on public.exams (slug);

create table public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  position int not null check (position > 0),
  section text,
  topic text,
  question_latex text not null,
  options jsonb not null,
  correct_idx int not null check (correct_idx between 0 and 3),
  explanation_latex text,
  marks_correct numeric,
  marks_wrong numeric,
  unique (exam_id, position)
);

create index idx_exam_questions_exam on public.exam_questions (exam_id, position);

-- ---------------------------------------------------------------------------
-- Registrations, attempts, answers
-- ---------------------------------------------------------------------------

create table public.exam_registrations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  registered_at timestamptz not null default now(),
  reminder_sent_24h boolean not null default false,
  reminder_sent_1h boolean not null default false,
  unique (exam_id, user_id)
);

create index idx_exam_registrations_exam on public.exam_registrations (exam_id);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  raw_score numeric,
  final_score numeric,
  percentile numeric,
  all_india_rank int,
  state_rank int,
  city_rank int,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'graded', 'disqualified')),
  device_info jsonb,
  unique (exam_id, user_id)
);

create index idx_attempts_exam_score on public.exam_attempts (exam_id, final_score desc nulls last);
create index idx_attempts_user on public.exam_attempts (user_id);

create table public.exam_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  question_id uuid not null references public.exam_questions (id) on delete cascade,
  selected_idx int check (selected_idx is null or selected_idx between 0 and 3),
  marked_for_review boolean not null default false,
  time_spent_sec int not null default 0,
  is_correct boolean,
  marks_awarded numeric,
  unique (attempt_id, question_id)
);

create index idx_exam_answers_attempt on public.exam_answers (attempt_id);

-- ---------------------------------------------------------------------------
-- Merit, violations, certificates
-- ---------------------------------------------------------------------------

create table public.merit_lists (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  published_at timestamptz not null default now(),
  total_attempts int not null,
  top_score numeric,
  median_score numeric,
  is_final boolean not null default false
);

create index idx_merit_lists_exam on public.merit_lists (exam_id);

create table public.violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  kind text not null
    check (kind in (
      'tab_blur', 'fullscreen_exit', 'paste', 'contextmenu',
      'devtools', 'heartbeat_gap', 'copy', 'dev_console'
    )),
  payload jsonb,
  at timestamptz not null default now()
);

create index idx_violations_attempt on public.violations (attempt_id);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.exam_attempts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  verification_code text unique not null,
  pdf_url text,
  issued_at timestamptz not null default now()
);

-- Public merit view (limited columns — security invoker respects RLS on base tables)
create or replace view public.public_merit
with (security_invoker = true)
as
select
  a.id as attempt_id,
  a.exam_id,
  a.all_india_rank,
  a.state_rank,
  a.city_rank,
  a.final_score,
  a.percentile,
  p.display_name,
  p.city,
  p.state
from public.exam_attempts a
join public.profiles p on p.id = a.user_id
join public.exams e on e.id = a.exam_id
where a.status = 'graded'
  and e.status = 'merit_published';

grant select on public.public_merit to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_registrations enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
alter table public.merit_lists enable row level security;
alter table public.violations enable row level security;
alter table public.certificates enable row level security;

-- Profiles
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles_admin_all"
  on public.profiles for all
  using (public.is_admin());

-- Exams
create policy "exams_select_public"
  on public.exams for select
  using (
    status in ('scheduled', 'live', 'closed', 'merit_published', 'archived')
    or public.is_admin()
  );

create policy "exams_admin_write"
  on public.exams for all
  using (public.is_admin());

-- Questions (registered users after exam is live+)
create policy "exam_questions_select"
  on public.exam_questions for select
  using (
    public.is_admin()
    or exists (
      select 1
      from public.exams e
      where e.id = exam_questions.exam_id
        and e.status in ('live', 'closed', 'merit_published')
        and exists (
          select 1
          from public.exam_registrations r
          where r.exam_id = e.id
            and r.user_id = auth.uid()
        )
    )
  );

create policy "exam_questions_admin_write"
  on public.exam_questions for all
  using (public.is_admin());

-- Registrations
create policy "exam_registrations_select"
  on public.exam_registrations for select
  using (auth.uid() = user_id or public.is_admin());

create policy "exam_registrations_insert_own"
  on public.exam_registrations for insert
  with check (auth.uid() = user_id);

create policy "exam_registrations_delete_own"
  on public.exam_registrations for delete
  using (auth.uid() = user_id or public.is_admin());

-- Attempts
create policy "exam_attempts_select"
  on public.exam_attempts for select
  using (auth.uid() = user_id or public.is_admin());

create policy "exam_attempts_insert_own"
  on public.exam_attempts for insert
  with check (auth.uid() = user_id);

create policy "exam_attempts_update_own_in_progress"
  on public.exam_attempts for update
  using (
    auth.uid() = user_id
    and status = 'in_progress'
  );

create policy "exam_attempts_admin_all"
  on public.exam_attempts for all
  using (public.is_admin());

-- Answers
create policy "exam_answers_all_own_attempt"
  on public.exam_answers for all
  using (
    exists (
      select 1
      from public.exam_attempts a
      where a.id = exam_answers.attempt_id
        and (a.user_id = auth.uid() or public.is_admin())
    )
  );

-- Merit lists
create policy "merit_lists_select_public"
  on public.merit_lists for select
  using (true);

create policy "merit_lists_admin_write"
  on public.merit_lists for all
  using (public.is_admin());

-- Violations
create policy "violations_select_own"
  on public.violations for select
  using (
    exists (
      select 1
      from public.exam_attempts a
      where a.id = violations.attempt_id
        and (a.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "violations_insert_own"
  on public.violations for insert
  with check (
    exists (
      select 1
      from public.exam_attempts a
      where a.id = violations.attempt_id
        and a.user_id = auth.uid()
        and a.status = 'in_progress'
    )
  );

-- Certificates
create policy "certificates_select_own"
  on public.certificates for select
  using (auth.uid() = user_id or public.is_admin());

create policy "certificates_admin_write"
  on public.certificates for all
  using (public.is_admin());
