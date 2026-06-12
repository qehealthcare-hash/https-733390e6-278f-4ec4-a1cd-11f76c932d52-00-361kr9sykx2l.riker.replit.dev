-- P1-A: inquiry convert idempotency — phone-level lock + strict already-converted return.
--
-- - Re-running convert on a Converted inquiry returns the same patient_id (no second insert).
-- - Concurrent converts for the same phone serialize on inquiry_phone lock.
-- - Converted inquiry with no matching patient raises a clear error instead of null patient_id.

begin;

create or replace function public.hh_convert_inquiry_to_patient(p_inquiry_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inq public.hh_inquiries%rowtype;
  v_pat public.hh_patients%rowtype;
  v_new_id text;
  v_disease text;
begin
  perform public._hh_require_role(array['Admin','Manager','Staff']);

  if p_inquiry_id is null or btrim(p_inquiry_id) = '' then
    raise exception 'inquiry_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('inquiry:' || p_inquiry_id));

  select * into v_inq
    from public.hh_inquiries
   where id = p_inquiry_id
   for update;

  if not found then raise exception 'inquiry % not found', p_inquiry_id; end if;

  if initcap(coalesce(v_inq.status, '')) = 'Converted' then
    select p.id into v_new_id
      from public.hh_patients p
     where coalesce(p.phone,'') <> ''
       and lower(coalesce(p.phone,'')) = lower(coalesce(v_inq.phone,''))
     limit 1;

    if v_new_id is null then
      raise exception
        'inquiry % is already Converted but no patient matches phone %',
        p_inquiry_id,
        coalesce(v_inq.phone, '');
    end if;

    return jsonb_build_object(
      'patient_id', v_new_id,
      'inquiry_id', p_inquiry_id,
      'already_converted', true
    );
  end if;

  if coalesce(v_inq.phone, '') <> '' then
    perform pg_advisory_xact_lock(hashtext('inquiry_phone:' || lower(v_inq.phone)));
  end if;

  v_disease := trim(both from concat_ws(
    ' — ',
    nullif(trim(coalesce(v_inq.service, '')), ''),
    nullif(trim(coalesce(v_inq.remarks, coalesce(v_inq.notes, ''))), '')
  ));

  select * into v_pat
  from public.hh_patients
  where coalesce(phone,'') <> '' and lower(coalesce(phone,'')) = lower(coalesce(v_inq.phone,''))
  for update
  limit 1;

  if found then
    v_new_id := v_pat.id;
    update public.hh_patients
    set
      age = case when coalesce(age, '') = '' then coalesce(v_inq.age, age) else age end,
      gender = case when coalesce(gender, '') = '' then coalesce(v_inq.gender, gender) else gender end,
      email = case when coalesce(email, '') = '' then coalesce(v_inq.email, email) else email end,
      disease_condition = case
        when coalesce(disease_condition, '') = '' and v_disease <> '' then v_disease
        else disease_condition
      end,
      updated_by = public.hh_current_actor(),
      updated_at = now()
    where id = v_new_id;
  else
    v_new_id := 'P' || to_char(now(), 'YYMMDD') ||
      lpad((abs(hashtext(gen_random_uuid()::text)) % 10000)::text, 4, '0');
    insert into public.hh_patients (
      id, name, phone, addr, area, city, age, gender, email, disease_condition,
      status, created, created_at, updated_at, created_by, updated_by
    ) values (
      v_new_id,
      coalesce(v_inq.name, ''),
      coalesce(v_inq.phone, ''),
      coalesce(v_inq.address, ''),
      coalesce(v_inq.area, ''),
      coalesce(v_inq.city, 'Ahmedabad'),
      coalesce(v_inq.age, ''),
      coalesce(v_inq.gender, ''),
      coalesce(v_inq.email, ''),
      coalesce(v_disease, ''),
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
$function$;

commit;
