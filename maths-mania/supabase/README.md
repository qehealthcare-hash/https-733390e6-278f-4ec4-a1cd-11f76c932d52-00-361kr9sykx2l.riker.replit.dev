# Supabase — Maths Mania

Milestone 9 foundation: Postgres schema, RLS, and Next.js client helpers.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Docker Desktop (for `supabase start` local stack)

## Local setup

```bash
cd maths-mania

# Start local Postgres + Auth + Studio
supabase start

# Apply migrations
supabase db reset

# Copy keys from `supabase status` into .env.local:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
```

Studio: http://localhost:54323

## Migrations

| File | Purpose |
|------|---------|
| `20250527000001_exam_platform_schema.sql` | Profiles, exams, attempts, merit, RLS, `public_merit` view |
| `20250527000002_marketing_tables.sql` | `newsletter_subscribers`, `resource_leads` |

## Regenerate TypeScript types

After changing SQL:

```bash
npm run db:types
```

## Health check

With env configured and migrations applied:

```bash
curl http://localhost:3000/api/health/supabase
```

## Security notes

- **Role checks** use `profiles.role` via `public.is_admin()` — not `user_metadata` in JWT.
- **Service role** is server-only (`lib/supabase/admin.ts`). Never expose in the browser.
- Marketing tables block all client RLS access; writes go through API routes with the service role.
