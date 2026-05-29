-- m14 — merit publish, ranking, certificates, public verification

create unique index if not exists idx_merit_lists_exam_unique on merit_lists (exam_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.generate_verification_code()
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

-- ---------------------------------------------------------------------------
-- publish_exam_merit
--   Admin-only. Grades submitted attempts, assigns ranks, writes merit_lists,
--   issues certificates to top 10%, sets exam.status = merit_published.
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
begin
  if not public.is_admin() then
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

  -- Auto-close if still live
  if v_exam.status = 'live' then
    update exams set status = 'closed', updated_at = v_now where id = p_exam_id;
  end if;

  -- Rank all submitted attempts (tie-break: higher score, then earlier submit)
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

  -- Top 10% get certificates (minimum 1 when any attempts exist)
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

revoke all on function public.publish_exam_merit(uuid) from public;
grant execute on function public.publish_exam_merit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- verify_certificate — public lookup by 12-char code (anon OK)
-- ---------------------------------------------------------------------------
create or replace function public.verify_certificate(p_code text)
returns table (
  valid boolean,
  exam_title text,
  display_name text,
  final_score numeric,
  all_india_rank int,
  percentile numeric,
  issued_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  r record;
begin
  if length(v_code) < 8 then
    return query
    select false, null::text, null::text, null::numeric, null::int, null::numeric, null::timestamptz;
    return;
  end if;

  select
    e.title,
    p.display_name,
    a.final_score,
    a.all_india_rank,
    a.percentile,
    c.issued_at
  into r
  from certificates c
  join exam_attempts a on a.id = c.attempt_id
  join exams e on e.id = c.exam_id
  join profiles p on p.id = c.user_id
  where c.verification_code = v_code
    and e.status = 'merit_published'
    and a.status = 'graded'
  limit 1;

  if not found then
    return query
    select false, null::text, null::text, null::numeric, null::int, null::numeric, null::timestamptz;
    return;
  end if;

  return query
  select true, r.title, r.display_name, r.final_score, r.all_india_rank, r.percentile, r.issued_at;
end;
$$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- Allow anon to read certificates only via RPC (no broad select policy change)
