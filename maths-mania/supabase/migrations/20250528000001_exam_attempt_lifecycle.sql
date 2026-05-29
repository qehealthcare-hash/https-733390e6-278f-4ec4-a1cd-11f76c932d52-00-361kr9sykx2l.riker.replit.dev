-- m13 — exam attempt lifecycle RPCs (start, submit, server time)

-- ---------------------------------------------------------------------------
-- start_exam_attempt
--   Atomically creates (or returns) the in-progress attempt for the caller.
--   Side-effect: promotes the exam from 'scheduled' → 'live' once start time
--   has passed, so RLS on exam_questions opens up for registered users.
-- ---------------------------------------------------------------------------
create or replace function public.start_exam_attempt(p_exam_id uuid)
returns table (
  attempt_id uuid,
  started_at timestamptz,
  exam_ends_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_exam exams%rowtype;
  v_attempt exam_attempts%rowtype;
  v_registered boolean;
  v_now timestamptz := now();
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_exam from exams where id = p_exam_id;
  if not found then
    raise exception 'EXAM_NOT_FOUND' using errcode = '02000';
  end if;
  if v_now < v_exam.starts_at then
    raise exception 'EXAM_NOT_STARTED' using errcode = 'P0001';
  end if;
  if v_now > v_exam.ends_at then
    raise exception 'EXAM_ENDED' using errcode = 'P0002';
  end if;

  select exists(
    select 1 from exam_registrations
    where exam_id = p_exam_id and user_id = v_user_id
  ) into v_registered;
  if not v_registered then
    raise exception 'NOT_REGISTERED' using errcode = 'P0003';
  end if;

  if v_exam.status = 'scheduled' then
    update exams
      set status = 'live', updated_at = v_now
    where id = p_exam_id and status = 'scheduled';
  end if;

  select * into v_attempt
  from exam_attempts
  where exam_id = p_exam_id and user_id = v_user_id;

  if found then
    if v_attempt.status <> 'in_progress' then
      raise exception 'ATTEMPT_FINISHED' using errcode = 'P0004';
    end if;
  else
    insert into exam_attempts (exam_id, user_id, started_at, status)
    values (p_exam_id, v_user_id, v_now, 'in_progress')
    returning * into v_attempt;
  end if;

  return query
    select v_attempt.id, v_attempt.started_at, v_exam.ends_at, v_now;
end;
$$;

revoke all on function public.start_exam_attempt(uuid) from public;
grant execute on function public.start_exam_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_exam_attempt
--   Grades all stored answers, fills marks_awarded + is_correct, and
--   finalizes the attempt row. Idempotent — re-submitting returns the
--   already-computed scorecard.
-- ---------------------------------------------------------------------------
create or replace function public.submit_exam_attempt(
  p_attempt_id uuid,
  p_auto_submitted boolean default false
)
returns table (
  raw_score numeric,
  final_score numeric,
  correct_count int,
  incorrect_count int,
  unattempted_count int,
  total_questions int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_attempt exam_attempts%rowtype;
  v_exam exams%rowtype;
  v_correct int := 0;
  v_incorrect int := 0;
  v_skip_with_row int := 0;
  v_total int := 0;
  v_raw numeric := 0;
  v_unattempted int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_attempt from exam_attempts where id = p_attempt_id;
  if not found then
    raise exception 'ATTEMPT_NOT_FOUND' using errcode = '02000';
  end if;
  if v_attempt.user_id <> v_user_id then
    raise exception 'NOT_OWNER' using errcode = '42501';
  end if;

  select * into v_exam from exams where id = v_attempt.exam_id;
  select count(*) into v_total from exam_questions where exam_id = v_attempt.exam_id;

  if v_attempt.status <> 'in_progress' then
    select
      coalesce(count(*) filter (where is_correct = true), 0),
      coalesce(count(*) filter (where selected_idx is not null and is_correct = false), 0)
    into v_correct, v_incorrect
    from exam_answers where attempt_id = p_attempt_id;
    v_unattempted := v_total - v_correct - v_incorrect;
    return query select
      v_attempt.raw_score,
      v_attempt.final_score,
      v_correct,
      v_incorrect,
      greatest(v_unattempted, 0),
      v_total;
    return;
  end if;

  update exam_answers a
  set
    is_correct = (a.selected_idx is not null and a.selected_idx = q.correct_idx),
    marks_awarded = case
      when a.selected_idx is null then coalesce(v_exam.marking_skip, 0)
      when a.selected_idx = q.correct_idx then coalesce(q.marks_correct, v_exam.marking_correct)
      else coalesce(q.marks_wrong, v_exam.marking_wrong)
    end
  from exam_questions q
  where a.attempt_id = p_attempt_id and a.question_id = q.id;

  select
    coalesce(count(*) filter (where is_correct = true), 0),
    coalesce(count(*) filter (where selected_idx is not null and is_correct = false), 0),
    coalesce(count(*) filter (where selected_idx is null), 0),
    coalesce(sum(marks_awarded), 0)
  into v_correct, v_incorrect, v_skip_with_row, v_raw
  from exam_answers where attempt_id = p_attempt_id;

  v_unattempted := v_total - v_correct - v_incorrect;
  if v_unattempted < 0 then v_unattempted := 0; end if;

  -- Add skip marks for questions never opened (no answer row at all)
  v_raw := v_raw + greatest(v_unattempted - v_skip_with_row, 0) * coalesce(v_exam.marking_skip, 0);

  update exam_attempts
  set
    submitted_at = now(),
    auto_submitted = p_auto_submitted,
    status = 'submitted',
    raw_score = v_raw,
    final_score = v_raw
  where id = p_attempt_id;

  return query select v_raw, v_raw, v_correct, v_incorrect, v_unattempted, v_total;
end;
$$;

revoke all on function public.submit_exam_attempt(uuid, boolean) from public;
grant execute on function public.submit_exam_attempt(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- exam_server_now — anchor for client countdown so users can't fake their clock
-- ---------------------------------------------------------------------------
create or replace function public.exam_server_now()
returns timestamptz
language sql
stable
as $$ select now(); $$;

grant execute on function public.exam_server_now() to anon, authenticated;
