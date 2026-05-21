# Production environment — copy-paste

Replace the placeholders, then paste into **Vercel → Project → Settings → Environment Variables** (Production).

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `WEB_HOST` | Your **Next.js** site, no trailing slash | `https://hominal-crm.vercel.app` |
| `API_HOST` | Your **Express API** origin, no `/api` suffix | `https://hominal-crm-api.vercel.app` |

The browser builds API URLs as **`API_HOST` + `/api`** + path (e.g. `/auth/me` → `…/api/auth/me`).

---

## API project (Vercel or Railway/Render)

```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...anon
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...service_role
APP_ORIGIN=WEB_HOST
PUBLIC_APP_URL=WEB_HOST
PORT=4000
```

**Concrete example** (web `https://hominal-crm.vercel.app`, API `https://hominal-crm-api.vercel.app`):

```
APP_ORIGIN=https://hominal-crm.vercel.app
PUBLIC_APP_URL=https://hominal-crm.vercel.app
```

`APP_ORIGIN` must match the **exact** browser origin of the Next app (scheme + host, no path). Used for CORS in `apps/api`.

---

## Web project (Vercel)

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJI...anon
NEXT_PUBLIC_API_URL=API_HOST/api
NEXT_PUBLIC_APP_URL=WEB_HOST
```

**Concrete example** (same hosts as above):

```
NEXT_PUBLIC_API_URL=https://hominal-crm-api.vercel.app/api
NEXT_PUBLIC_APP_URL=https://hominal-crm.vercel.app
```

Notes:

- `NEXT_PUBLIC_API_URL` **must end with `/api`** (no trailing slash after `api`).
- Do **not** set `SUPABASE_SERVICE_ROLE_KEY` on the web project.

---

## One-liner reference

| Where | Variable | Value |
|-------|----------|--------|
| API | `APP_ORIGIN` | `WEB_HOST` |
| Web | `NEXT_PUBLIC_APP_URL` | `WEB_HOST` |
| Web | `NEXT_PUBLIC_API_URL` | `API_HOST` + `/api` |

After saving env vars, **redeploy** both projects.
