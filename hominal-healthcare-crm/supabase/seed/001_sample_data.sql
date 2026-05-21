insert into public.employees (id, full_name, mobile, address, role, education, shift_type)
values
  ('11111111-1111-1111-1111-111111111111', 'Aashaben Patel', '7041201222', 'Thaltej, Ahmedabad', 'NURSE', 'GRADUATE', 'DAY'),
  ('22222222-2222-2222-2222-222222222222', 'Soniben Vaniya', '9054990120', 'Naranpura, Ahmedabad', 'ATTENDANT', 'PASS_10_12', '24H')
on conflict (id) do nothing;

insert into public.patients (
  id, full_name, age, gender, address, area, city, pincode, mobile,
  disease_condition, assigned_staff_id, shift_type, start_date, status, close_reason, relative_contacts
)
values
  (
    '33333333-3333-3333-3333-333333333333',
    'Indiraben Shukla',
    78,
    'Female',
    'Shastrinagar, Ahmedabad',
    'Naranpura',
    'Ahmedabad',
    '380013',
    '9427902477',
    'Post operative care',
    '11111111-1111-1111-1111-111111111111',
    'DAY',
    current_date - interval '15 day',
    'ACTIVE',
    null,
    '[{"name":"Vaishaliben","phone":"9427902479"}]'::jsonb
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Tejalben Patel',
    58,
    'Female',
    'Bopal, Ahmedabad',
    'Bopal',
    'Ahmedabad',
    '380058',
    '7874701478',
    'Bedridden support',
    '22222222-2222-2222-2222-222222222222',
    '24H',
    current_date - interval '30 day',
    'ACTIVE',
    null,
    '[{"name":"Relative One","phone":"7874701400"}]'::jsonb
  )
on conflict (id) do nothing;

insert into public.inquiries (
  id, patient_name, mobile, area, city, service_required, source, potential,
  emergency_level, flexibility_score, priority_score, notes
)
values
  (
    '55555555-5555-5555-5555-555555555555',
    'Kokilaben Shah',
    '8460060663',
    'Naranpura',
    'Ahmedabad',
    'Attendant service',
    'WHATSAPP',
    'HOT',
    8,
    6,
    9,
    'Needs urgent female attendant'
  )
on conflict (id) do nothing;

insert into public.invoices (
  id, patient_id, service_month, invoice_type, security_deposit, subtotal_amount, outstanding_amount, status
)
values
  (
    '66666666-6666-6666-6666-666666666666',
    '33333333-3333-3333-3333-333333333333',
    date_trunc('month', current_date)::date,
    'PROVISIONAL',
    5000,
    30000,
    12000,
    'OPEN'
  )
on conflict (id) do nothing;

insert into public.invoice_items (
  id, invoice_id, patient_id, assigned_staff_id, service_name, duration_label,
  total_days, total_people, rate_per_day, absent_days, line_total
)
values
  (
    '77777777-7777-7777-7777-777777777777',
    '66666666-6666-6666-6666-666666666666',
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'Nursing Day Care',
    'Monthly',
    30,
    1,
    1000,
    0,
    30000
  )
on conflict (id) do nothing;

insert into public.receipts (
  id, invoice_id, amount, payment_mode, received_on, note
)
values
  (
    '88888888-8888-8888-8888-888888888888',
    '66666666-6666-6666-6666-666666666666',
    18000,
    'UPI',
    current_date - interval '2 day',
    'Advance part collection'
  )
on conflict (id) do nothing;

insert into public.payout_runs (
  id, employee_id, payout_month, total_amount, paid_amount, pending_amount
)
values
  (
    '99999999-9999-9999-9999-999999999999',
    '11111111-1111-1111-1111-111111111111',
    date_trunc('month', current_date)::date,
    24000,
    10000,
    14000
  )
on conflict (id) do nothing;

insert into public.payout_entries (
  id, payout_id, employee_id, patient_id, invoice_item_id, service_name, total_days, rate_per_day, amount
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '99999999-9999-9999-9999-999999999999',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    '77777777-7777-7777-7777-777777777777',
    'Nursing Day Care',
    24,
    1000,
    24000
  )
on conflict (id) do nothing;

insert into public.payout_payments (
  id, payout_id, amount_paid, payment_mode, payment_date, proof_file_path
)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '99999999-9999-9999-9999-999999999999',
    10000,
    'BANK',
    current_date - interval '1 day',
    null
  )
on conflict (id) do nothing;
