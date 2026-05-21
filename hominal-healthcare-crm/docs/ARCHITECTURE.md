# Architecture

## Why this design

- Supabase handles authentication, storage, realtime events, and PostgreSQL scale.
- Express owns business rules, validation, and audit logging.
- Next.js handles dashboards, forms, and realtime subscriptions.

## Sync model

1. User signs in through Supabase Auth.
2. Web app stores the session.
3. CRUD calls go to Express with the user access token.
4. Express validates token, loads `app_users`, resolves **permission codes** from `crm_role_permission_grants` (60s in-memory cache per role; static fallback if migrations not applied), then checks `requirePermission` against that list. Writes use the service role server-side only.
5. `GET /auth/me` returns the profile plus `permissions[]` so the Next.js shell matches the API without duplicating business rules.
6. Supabase Realtime notifies all open clients.
7. Clients re-fetch the affected module.

## Stability features

- offline mutation queue in the browser
- role-checked API routes
- audit log per critical change
- normalized invoice and payout tables
- storage-backed document uploads
