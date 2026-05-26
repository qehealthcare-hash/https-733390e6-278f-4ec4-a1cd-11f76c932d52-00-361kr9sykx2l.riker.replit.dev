# Deployment — canonical source

**Production deploys from this directory only:** `vercel-web/`

- URL: https://crm.hominalhealthcare.com
- Legacy SPA (Classic CRM iframe): `public/legacy-crm.html` in **this** folder only.

Do not deploy from `hominal-healthcare-crm/apps/web` or root `index.html` — those copies can drift and caused the May 2026 audit findings.

After schema changes, apply migrations under `supabase/migrations/` to project `hkyjxdmkqkydnrafhpgn` before promoting a Vercel build.
