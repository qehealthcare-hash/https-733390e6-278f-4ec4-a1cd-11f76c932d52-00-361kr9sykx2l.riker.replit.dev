# API Structure

Base URL: `/api`

## Auth

- `GET /auth/me`
  Returns the CRM profile from `app_users` plus `permissions: string[]` resolved from `crm_role_permission_grants` (migration `008`), with static fallback if the table is empty or missing.
- `POST /auth/register`
  Admin-only user provisioning endpoint. Creates a Supabase Auth user and the matching `app_users` row in one transaction flow.

## Dashboard

- `GET /dashboard/summary`
  KPI summary for dashboard cards.

## Patients

- `GET /patients`
- `GET /patients/:id`
- `POST /patients`
- `PUT /patients/:id`
- `DELETE /patients/:id`

Payload highlights:
- `status = CLOSED` requires `close_reason`
- supports up to 3 `relative_contacts`
- supports `documents[]` metadata for storage-backed files

## Employees

- `GET /employees`
- `GET /employees/:id`
- `POST /employees`
- `PUT /employees/:id`
- `DELETE /employees/:id`

Payload highlights:
- documents are mandatory
- documents are stored in `employee_documents`

## Inquiries

- `GET /inquiries`
- `POST /inquiries`
- `PUT /inquiries/:id`
- `DELETE /inquiries/:id`

## Billing

- `GET /billings`
- `GET /billings/:id`
- `POST /billings`
- `PATCH /billings/:id/status`
- `POST /billings/receipts`

Logic highlights:
- invoice items calculate line totals server-side
- closing a bill updates the linked patient lifecycle to `CLOSED`
- final bills can apply security deposit as credit

## Payouts

- `GET /payouts`
- `GET /payouts/:id`
- `POST /payouts`
- `POST /payouts/payments`

Logic highlights:
- each payout run belongs to a single employee
- entries support multiple patients in the same month
- partial payments reduce `pending_amount`

## Reports

- `GET /reports/patient-billing`
- `GET /reports/employee-payout`
- `GET /reports/profit-loss`
- `GET /reports/inquiry-conversion`
- `GET /reports/attendance-service`

## Uploads

- `POST /uploads/signed-url`
- `POST /uploads/download-url`

These endpoints issue signed Supabase Storage URLs so the browser can upload or preview documents without exposing the service role key.

## Lookups

- `GET /lookups/areas`
- `GET /lookups/employees`
- `GET /lookups/patients`

## Reference data (requires migrations `006`+)

Base path: `/api/reference`

- `GET /reference/doctors` — `doctors.read`
- `GET /reference/doctors/:id`
- `POST /reference/doctors` — `doctors.write`
- `PUT /reference/doctors/:id`
- `DELETE /reference/doctors/:id` (soft delete)

- `GET /reference/vendors` — `vendors.read`
- `GET /reference/vendors/:id`
- `POST /reference/vendors` — `vendors.write`
- `PUT /reference/vendors/:id`
- `DELETE /reference/vendors/:id` (soft delete)

- `GET /reference/service-catalog` — `catalog.read`

- `GET /reference/settings` — `settings.read`
- `GET /reference/settings/:key`
- `PUT /reference/settings` — `settings.write` (body: `{ key, value }`; admin only via role map)
