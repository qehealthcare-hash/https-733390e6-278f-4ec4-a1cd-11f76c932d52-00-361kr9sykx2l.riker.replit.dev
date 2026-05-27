-- Maths Mania m11 — seed 2 demo live exams (Banking 30 min, SSC 20 min)
-- Idempotent: safe to re-run on conflict.

do $$
declare
  bank_start timestamptz;
  ssc_start timestamptz;
  bank_id uuid;
  ssc_id uuid;
begin
  -- Next Sunday 11:00 IST from migration apply time
  bank_start := (
    date_trunc('week', (now() at time zone 'Asia/Kolkata') + interval '7 days')
    + time '11:00'
  ) at time zone 'Asia/Kolkata';

  ssc_start := bank_start + interval '14 days';

  insert into public.exams (
    slug, title, description, pillar, difficulty,
    duration_min, total_marks,
    marking_correct, marking_wrong, marking_skip,
    starts_at, ends_at,
    registration_opens_at, registration_closes_at,
    status, is_free, rules_md
  ) values (
    'ibps-quant-speed-test-2',
    'IBPS Quant Speed Test #2',
    'Free 30-minute All-India mock — simplification, DI, and arithmetic at prelims pace.',
    'banking', 'medium',
    30, 20,
    1.0, -0.25, 0,
    bank_start,
    bank_start + interval '30 minutes',
    now(),
    bank_start,
    'scheduled', true,
    'One attempt per student. No negative marking on skipped questions. Merit list publishes ~60 minutes after close.'
  )
  on conflict (slug) do update set
    title = excluded.title,
    updated_at = now()
  returning id into bank_id;

  if bank_id is null then
    select id into bank_id from public.exams where slug = 'ibps-quant-speed-test-2';
  end if;

  insert into public.exams (
    slug, title, description, pillar, difficulty,
    duration_min, total_marks,
    marking_correct, marking_wrong, marking_skip,
    starts_at, ends_at,
    registration_opens_at, registration_closes_at,
    status, is_free, rules_md
  ) values (
    'ssc-cgl-quant-sprint-1',
    'SSC CGL Quant Sprint #1',
    '20-minute Tier-1 style quant drill — percentages, ratio, and speed arithmetic.',
    'ssc', 'medium',
    20, 20,
    1.0, -0.25, 0,
    ssc_start,
    ssc_start + interval '20 minutes',
    now(),
    ssc_start,
    'scheduled', true,
    'Synchronized start. Calculator not allowed. Top 10% receive a downloadable certificate after merit publish.'
  )
  on conflict (slug) do update set
    title = excluded.title,
    updated_at = now()
  returning id into ssc_id;

  if ssc_id is null then
    select id into ssc_id from public.exams where slug = 'ssc-cgl-quant-sprint-1';
  end if;

  -- Banking questions (8)
  insert into public.exam_questions (exam_id, position, section, topic, question_latex, options, correct_idx, explanation_latex)
  values
    (bank_id, 1, 'Arithmetic', 'Simplification', '48\\% \\text{ of } 250 + 12\\% \\text{ of } 500 = ?', '["180","192","200","168"]'::jsonb, 0, '120 + 60 = 180'),
    (bank_id, 2, 'Arithmetic', 'Percentage', 'A number is increased by 20\\% then decreased by 20\\%. Net change?', '["0\\%","4\\% \\text{ increase}","4\\% \\text{ decrease}","2\\% \\text{ decrease}"]'::jsonb, 2, '1.2 \\times 0.8 = 0.96'),
    (bank_id, 3, 'Arithmetic', 'Ratio', 'A:B=3:5, B:C=2:3. Then A:C = ?', '["2:5","6:15","2:3","9:10"]'::jsonb, 0, 'A:B:C = 6:10:15'),
    (bank_id, 4, 'Arithmetic', 'Series', '2,6,12,20,30,?', '["40","42","44","38"]'::jsonb, 1, '+4,+6,+8,+10 \\Rightarrow 42'),
    (bank_id, 5, 'Arithmetic', 'Profit', 'CP=400, profit 25\\%. SP=?', '["450","500","525","480"]'::jsonb, 1, '500'),
    (bank_id, 6, 'Speed', 'Trick', '34 \\times 11 = ?', '["374","364","384","354"]'::jsonb, 0, '3|(3+4)|4'),
    (bank_id, 7, 'Arithmetic', 'Average', 'Avg of 5 numbers is 24. Replace 30 with 18. New avg?', '["22.4","21.6","23.2","22"]'::jsonb, 1, '108/5'),
    (bank_id, 8, 'Arithmetic', 'Roots', '\\sqrt{0.16}+\\sqrt{0.09}=?', '["0.7","0.5","0.25","1.3"]'::jsonb, 0, '0.4+0.3')
  on conflict (exam_id, position) do nothing;

  -- SSC questions (8)
  insert into public.exam_questions (exam_id, position, section, topic, question_latex, options, correct_idx, explanation_latex)
  values
    (ssc_id, 1, 'Percentage', 'Basics', '45 \\text{ is what \\% of } 180?', '["20\\%","25\\%","30\\%","22.5\\%"]'::jsonb, 1, '45/180=1/4'),
    (ssc_id, 2, 'Percentage', 'Flip', '16\\frac{2}{3}\\% \\text{ of } 90 = ?', '["15","150","90","540"]'::jsonb, 0, 'x\\% of y = y\\% of x'),
    (ssc_id, 3, 'Percentage', 'Successive', '10\\% up then 10\\% down. Net?', '["0\\%","1\\% up","1\\% down","2\\% down"]'::jsonb, 2, '0.99'),
    (ssc_id, 4, 'Percentage', 'Fraction', '3/8 = ?', '["37.5\\%","38\\%","35\\%","62.5\\%"]'::jsonb, 0, NULL),
    (ssc_id, 5, 'Percentage', 'Comparison', 'Which is greater: 20\\% of 80 or 25\\% of 60?', '["First","Second","Equal","Cannot say"]'::jsonb, 2, 'Both 16'),
    (ssc_id, 6, 'Percentage', 'Discount', 'MP=800, 15\\% off. SP?', '["680","720","700","640"]'::jsonb, 0, NULL),
    (ssc_id, 7, 'Percentage', 'Salary', '25000 + 12\\% = ?', '["27500","28000","27000","28500"]'::jsonb, 1, NULL),
    (ssc_id, 8, 'Percentage', 'Reverse', 'After 20\\% discount SP=640. MP?', '["768","800","760","820"]'::jsonb, 1, '640/0.8')
  on conflict (exam_id, position) do nothing;
end $$;
