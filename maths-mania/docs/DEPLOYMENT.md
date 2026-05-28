# Production deployment — Maths Mania

Target stack: **Vercel** (Next.js) + **Supabase** (Postgres + Auth) + **Upstash Redis** (rate limits + OTP) + **Vercel Cron** (exam lifecycle).

## 1. Supabase (production project)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Link the CLI (optional): `supabase link --project-ref <ref>`.
3. Push migrations:

   ```bash
   cd maths-mania
   supabase db push
   ```

   Or paste SQL from `supabase/migrations/` in order via the SQL editor.

4. Copy API keys from **Project Settings → API** into Vercel env:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — never expose to the browser)

5. **Auth providers** (Authentication → Providers):
   - Email magic link (enabled by default)
   - Google OAuth — add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to Vercel and redirect URL  
     `https://<your-domain>/auth/callback`
   - Phone OTP — configure MSG91; set `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`

6. Promote your admin user after first signup:

   ```sql
   update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
   ```

7. Enable **connection pooling** (Supavisor) for serverless — use the pooler URL if you add direct Postgres clients later.

## 2. Upstash Redis

1. Create a database at [console.upstash.com](https://console.upstash.com).
2. Add to Vercel:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Used for: marketing form rate limits, phone OTP storage (multi-instance safe).

Without Upstash, the app falls back to in-memory limits (fine for local dev only).

## 3. Vercel

### First deploy

1. Import the Git repo in [vercel.com/new](https://vercel.com/new).
2. Set **Root Directory** to `maths-mania` (this monorepo has other apps at the root).
3. Framework preset: **Next.js** (auto-detected).
4. Add all variables from `.env.example` for **Production** (and Preview if needed).
5. Deploy.

### CLI alternative

```bash
cd maths-mania
npx vercel link
npx vercel env pull .env.local
npx vercel --prod
```

### Required production env vars

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (`https://mathsmania.in`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron, dual-write APIs, admin operations |
| `CRON_SECRET` | Random 32+ char string — Vercel Cron sends `Authorization: Bearer <secret>` |
| `UPSTASH_REDIS_REST_URL` | Rate limit + OTP |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limit + OTP |
| `YOUTUBE_API_KEY` | Live video grid (optional — placeholders without it) |
| `MERIT_PUBLISH_DELAY_MIN` | Minutes after `ends_at` before auto merit (default `60`) |

### Cron (automatic)

`vercel.json` registers:

| Schedule | Path | Action |
|----------|------|--------|
| Every 5 min | `/api/cron/exam-lifecycle` | `scheduled→live`, `live→closed`, auto-publish merit |

Vercel injects `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in the project.

**Manual smoke test** (staging):

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://<preview-url>/api/cron/exam-lifecycle" | jq
```

### Custom domain

1. Vercel → Project → **Domains** → add `mathsmania.in` (+ `www`).
2. Update DNS per Vercel instructions.
3. Set `NEXT_PUBLIC_SITE_URL` to the production URL and redeploy.

## 4. YouTube Data API key

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project → **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **Credentials → Create credentials → API key** — restrict by HTTP referrer to your domain.
4. Set `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` on Vercel.

## 5. Post-deploy checklist

- [ ] `curl https://<domain>/api/health/supabase` returns `{ "ok": true }`
- [ ] Sign up → onboarding → `/dashboard` loads
- [ ] Admin can open `/admin/exams` after role promotion
- [ ] Register for a live exam → lobby → attempt → submit → result
- [ ] Cron run logs show in Vercel → **Logs** (filter `/api/cron/exam-lifecycle`)
- [ ] Merit auto-publishes ~`MERIT_PUBLISH_DELAY_MIN` after exam end (or publish manually from admin)
- [ ] Lighthouse on `/` and `/exams/<slug>` (see `npm run perf:lighthouse`)

## 6. Migrations on production

After pulling new SQL:

```bash
supabase db push
# or: supabase migration up --linked
```

Regenerate types locally:

```bash
npm run db:types
```

## 7. Load testing (staging only)

See [LOAD_TEST.md](./LOAD_TEST.md). Do not point k6 at production without isolating a staging Supabase project.

## 8. Reminders (future)

Exam reminder emails/WhatsApp (24h / 1h before start) require Resend + MSG91 templates — flags exist on `exam_registrations` but batch sending is not wired in v1. Admins can rely on newsletter + manual WhatsApp until a dedicated reminders cron is added.
