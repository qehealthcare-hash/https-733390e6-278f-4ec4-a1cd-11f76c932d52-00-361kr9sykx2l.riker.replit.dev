-- m22 — cron: exam status transitions + service_role merit publish

-- ---------------------------------------------------------------------------
-- publish_exam_merit — allow Vercel Cron (service_role) in addition to admins
-- ---------------------------------------------------------------------------
create or replace function public.publish_exam_merit(p_exam_id uuid)
returns table (
  total_attempts int,
  top_score numeric,
  median_score numeric,
  certificates_issued int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam exams%rowtype;
  v_total int;
  v_top numeric;
  v_median numeric;
  v_cert_count int := 0;
  v_top_n int;
  v_now timestamptz := now();
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if not public.is_admin() and v_role is distinct from 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_exam from exams where id = p_exam_id;
  if not found then
    raise exception 'EXAM_NOT_FOUND' using errcode = '02000';
  end if;

  if v_exam.status = 'merit_published' then
    select count(*)::int into v_total
    from exam_attempts
    where exam_id = p_exam_id and status in ('submitted', 'graded');
    select coalesce(max(final_score), 0) into v_top
    from exam_attempts where exam_id = p_exam_id and status = 'graded';
    select coalesce(
      percentile_cont(0.5) within group (order by final_score),
      0
    ) into v_median
    from exam_attempts where exam_id = p_exam_id and status = 'graded';
    select count(*)::int into v_cert_count
    from certificates where exam_id = p_exam_id;
    return query select v_total, v_top, v_median, v_cert_count;
    return;
  end if;

  if v_exam.status not in ('closed', 'live') then
    raise exception 'EXAM_NOT_READY' using errcode = 'P0001';
  end if;

  if v_now < v_exam.ends_at then
    raise exception 'EXAM_NOT_ENDED' using errcode = 'P0002';
  end if;

  if v_exam.status = 'live' then
    update exams set status = 'closed', updated_at = v_now where id = p_exam_id;
  end if;

  with ranked as (
    select
      a.id as attempt_id,
      a.user_id,
      a.final_score,
      p.state,
      p.city,
      row_number() over (
        order by a.final_score desc nulls last, a.submitted_at asc nulls last
      )::int as air,
      row_number() over (
        partition by coalesce(nullif(trim(p.state), ''), '—')
        order by a.final_score desc nulls last, a.submitted_at asc nulls last
      )::int as sr,
      row_number() over (
        partition by coalesce(nullif(trim(p.city), ''), '—')
        order by a.final_score desc nulls last, a.submitted_at asc nulls last
      )::int as cr,
      count(*) over ()::int as cohort
    from exam_attempts a
    join profiles p on p.id = a.user_id
    where a.exam_id = p_exam_id
      and a.status in ('submitted', 'graded')
      and a.submitted_at is not null
  )
  update exam_attempts a
  set
    status = 'graded',
    all_india_rank = r.air,
    state_rank = r.sr,
    city_rank = r.cr,
    percentile = round(
      (1.0 - (r.air::numeric - 1) / greatest(r.cohort, 1)) * 100,
      2
    )
  from ranked r
  where a.id = r.attempt_id;

  select count(*)::int into v_total
  from exam_attempts
  where exam_id = p_exam_id and status = 'graded';

  select coalesce(max(final_score), 0) into v_top
  from exam_attempts where exam_id = p_exam_id and status = 'graded';

  select coalesce(
    percentile_cont(0.5) within group (order by final_score),
    0
  ) into v_median
  from exam_attempts where exam_id = p_exam_id and status = 'graded';

  insert into merit_lists (exam_id, total_attempts, top_score, median_score, is_final)
  values (p_exam_id, v_total, v_top, v_median, true)
  on conflict (exam_id) do update
  set
    total_attempts = excluded.total_attempts,
    top_score = excluded.top_score,
    median_score = excluded.median_score,
    is_final = true,
    published_at = v_now;

  update exams
  set
    status = 'merit_published',
    merit_publish_at = v_now,
    updated_at = v_now
  where id = p_exam_id;

  v_top_n := greatest(1, ceil(v_total * 0.1)::int);

  insert into certificates (attempt_id, user_id, exam_id, verification_code)
  select
    a.id,
    a.user_id,
    p_exam_id,
    public.generate_verification_code()
  from exam_attempts a
  where a.exam_id = p_exam_id
    and a.status = 'graded'
    and a.all_india_rank is not null
    and a.all_india_rank <= v_top_n
    and not exists (
      select 1 from certificates c where c.attempt_id = a.id
    );

  get diagnostics v_cert_count = row_count;

  return query select v_total, v_top, v_median, v_cert_count;
end;
$$;

grant execute on function public.publish_exam_merit(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- cron_advance_exam_statuses — service_role only
-- ---------------------------------------------------------------------------
create or replace function public.cron_advance_exam_statuses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_live int := 0;
  v_closed int := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  with promoted as (
    update public.exams
    set status = 'live', updated_at = v_now
    where status = 'scheduled' and starts_at <= v_now
    returning id
  )
  select count(*)::int into v_live from promoted;

  with promoted as (
    update public.exams
    set status = 'closed', updated_at = v_now
    where status = 'live' and ends_at < v_now
    returning id
  )
  select count(*)::int into v_closed from promoted;

  return jsonb_build_object(
    'promoted_live', v_live,
    'promoted_closed', v_closed
  );
end;
$$;

revoke all on function public.cron_advance_exam_statuses() from public;
grant execute on function public.cron_advance_exam_statuses() to service_role;
