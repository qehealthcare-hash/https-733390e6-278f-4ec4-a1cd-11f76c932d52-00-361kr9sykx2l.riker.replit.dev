# Operations runbook (Phase 15)

## Error monitoring — Sentry (recommended)

1. Create a Sentry project (Next.js).
2. In **Vercel → hominal-healthcare-web → Environment Variables** (Production + Preview):

| Variable | Notes |
|---|---|
| `SENTRY_DSN` | Server DSN (secret) |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN for browser (optional if server-only) |
| `SENTRY_AUTH_TOKEN` | For source map upload on build (optional) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | If using upload |

3. Redeploy. Unhandled API 500s and `app/global-error.tsx` crashes are captured when DSN is set.
4. **Tunnel:** events may route via `/monitoring` (see `next.config.mjs`) to reduce ad-blocker drops.

### Datadog (alternative)

- Install [Vercel ↔ Datadog](https://vercel.com/integrations/datadog) on the project, or
- Forward Sentry → Datadog with the Sentry Datadog integration.

No Datadog SDK is bundled unless you add it later.

---

## Supabase — daily backups

Project: `hkyjxdmkqkydnrafhpgn` (crm hominalhealthcare, ap-northeast-1).

1. **Dashboard → Project Settings → Database → Backups**
2. Enable **Point-in-Time Recovery (PITR)** on a paid plan, or confirm **daily backups** are on.
3. Record the retention window in your internal IT register.
4. Quarterly: restore to a **branch** and run `npm test` against branch credentials.

Migrations live in `vercel-web/supabase/migrations/` — apply to production only after review.

---

## Auth — leaked password protection

1. **Supabase Dashboard → Authentication → Providers → Email**
2. Enable **Leaked password protection** (Have I Been Pwned check).
3. Enforce minimum password length ≥ 12 for new users.

This cannot be enabled via SQL; it is an Auth project setting.

---

## Dependency audit

```bash
cd vercel-web
npm audit
```

`package.json` includes an `overrides` pin for `postcss >= 8.5.10` (transitive via Next.js). Re-run audit after every major `next` upgrade.

---

## Health check

`GET /api/v1/health` — use for uptime monitors (UptimeRobot, Vercel, etc.). Returns `{ success, data }` without secrets.
