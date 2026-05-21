# Setup Guide

## 1. Supabase project

1. Create a new Supabase project.
2. Open SQL editor.
3. Run [001_initial_schema.sql](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/supabase/migrations/001_initial_schema.sql).
4. Run [001_sample_data.sql](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/supabase/seed/001_sample_data.sql).
5. Enable Realtime for:
   - `patients`
   - `employees`
   - `inquiries`
   - `invoices`
   - `payout_runs`
6. In Authentication, create app users and confirm emails.

## 2. API setup

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Fill Supabase URL, anon key, and service role key.
3. Install dependencies from repo root:
   - `npm install`
4. Start API:
   - `npm run dev:api`

## 3. Web setup

1. Copy `apps/web/.env.example` to `apps/web/.env.local`.
2. Point `NEXT_PUBLIC_API_URL` to the Express API.
3. Start frontend:
   - `npm run dev:web`
4. Review endpoint contracts in [API_STRUCTURE.md](/Users/bhawinkadikar/Downloads/bhavin/hominal-healthcare-crm/docs/API_STRUCTURE.md) if you plan to connect automation, WhatsApp, or external back-office tooling.

## 4. Auth bootstrap

1. Create the first Admin user in Supabase Auth.
2. Insert the first matching row into `app_users` with the correct `auth_user_id`.
3. After the first admin can sign in, use the backend `POST /api/auth/register` endpoint for future user provisioning.
4. Recommended starter roles:
   - Admin
   - Staff
   - Accountant
   - Nurse
   - Attendant

## 5. Storage buckets

Use the storage buckets created by the migration:
- `employee-documents`
- `patient-documents`
- `payout-proofs`

## 6. Go live

Frontend:
- deploy `apps/web` to Vercel

Backend:
- deploy `apps/api` to Railway, Render, Fly.io, or Vercel serverless Node runtime

Realtime:
- stays on Supabase

## 7. No-data-loss strategy

- CRUD flows go through Express validation
- browser keeps an offline queue for failed mutations
- `flushOfflineQueue()` retries after reconnect and after successful sign-in
- UI refreshes through Supabase Realtime subscriptions
