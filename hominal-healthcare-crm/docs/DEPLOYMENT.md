# Deployment

## Production env (copy-paste)

Use **[PRODUCTION_ENV_PASTE.md](./PRODUCTION_ENV_PASTE.md)** — set `WEB_HOST` and `API_HOST`, then paste into Vercel (or your host).

Summary:

- **API:** `APP_ORIGIN` = your **Next.js** URL (CORS).
- **Web:** `NEXT_PUBLIC_API_URL` = `https://<api-host>/api` (must include `/api`).

`apps/web/vercel.json` no longer proxies to a hardcoded API; the browser uses `NEXT_PUBLIC_API_URL` only.

## Frontend on Vercel

1. Import `apps/web` into Vercel.
2. Set environment variables from `.env.example` and **PRODUCTION_ENV_PASTE.md**.
3. Build command:
   - `npm run build --workspace apps/web`
4. Output:
   - Next.js default

## Backend on Render or Railway

1. Deploy `apps/api`.
2. Build command:
   - `npm install && npm run build --workspace apps/api`
3. Start command:
   - `npm run start --workspace apps/api`
4. Set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_ORIGIN`

## Supabase

1. Run migration and seed SQL.
2. Create Auth users.
3. Add matching `app_users` records.
4. Enable Realtime on operational tables.

## Production checklist

- Enforce strong passwords and MFA for Admin
- Confirm storage policies per bucket
- Add Sentry / Logtail / Axiom logging
- Add scheduled backups and PITR
- Add API rate limiting before public rollout
