-- m20 — tolerate concurrent start_exam_attempt from the same user (double-click / retry)

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

  if not found then
    insert into exam_attempts (exam_id, user_id, started_at, status)
    values (p_exam_id, v_user_id, v_now, 'in_progress')
    on conflict (exam_id, user_id) do nothing;

    select * into v_attempt
    from exam_attempts
    where exam_id = p_exam_id and user_id = v_user_id;
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'ATTEMPT_FINISHED' using errcode = 'P0004';
  end if;

  return query
    select v_attempt.id, v_attempt.started_at, v_exam.ends_at, v_now;
end;
$$;
