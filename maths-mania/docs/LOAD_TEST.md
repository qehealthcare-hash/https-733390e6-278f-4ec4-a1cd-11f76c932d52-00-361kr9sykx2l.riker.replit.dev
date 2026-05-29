# Exam platform load testing (m20 / §14.7)

Target: **p95 &lt; 400ms** for answer autosave at **500 concurrent virtual users** on staging/production infrastructure.

## What gets exercised

| Endpoint | Auth | Simulates |
|----------|------|-----------|
| `GET /api/exams/server-time` | No | Lobby / attempt clock sync |
| `POST /api/exams/attempt/start` | Bearer JWT | Entering the exam |
| `POST /api/exams/attempt/answer` | Bearer JWT | Autosave every ~5s |

Server actions are not used by k6; HTTP routes call the same Supabase RPCs and `exam_answers` upserts with RLS.

## Prerequisites

1. [k6](https://k6.io/docs/get-started/installation/) installed locally.
2. Supabase running (`supabase start` + `supabase db reset`) or a staging project.
3. Next.js app running (`npm run dev` or deployed `BASE_URL`).
4. A **live** exam (`starts_at <= now <= ends_at`, user registered). Seed exam: `ibps-quant-speed-test-2` — adjust schedule in admin if needed.

## 1. Prepare test users

Creates N users, registers them for the exam, mints JWTs, writes `scripts/.loadtest.env`:

```bash
cd maths-mania
node scripts/loadtest-prepare.mjs --users 100 --slug ibps-quant-speed-test-2
```

Optional env:

- `LOAD_TEST_PASSWORD` — password for synthetic users (default `LoadTest123!`)
- `BASE_URL` — default `http://localhost:3000`

## 2. Smoke test (no auth)

```bash
k6 run scripts/loadtest-smoke.js -e BASE_URL=http://localhost:3000
```

## 3. Full exam storm

```bash
k6 run --env-file scripts/.loadtest.env scripts/loadtest.js
```

Tune ramp with `LOAD_TEST_MAX_VUS` in the env file (default caps at token count, max 500).

## Interpreting results

- **http_req_duration p(95)** should stay under 400ms on adequate infra.
- Failed checks often mean: exam not live, expired JWT, or too few `AUTH_TOKENS` vs VUs (reuse tokens only for read-heavy tests; each VU should map to its own user for writes).

## Infrastructure notes (documented max concurrency)

| Tier | Rough guidance |
|------|----------------|
| **Vercel Hobby** | Not suitable for 500 concurrent exam writers; use staging Pro + Supabase Pro for load tests. |
| **Vercel Pro + Supabase Pro** | 500 VUs achievable with connection pooling (Supavisor); watch Postgres CPU and API route duration in dashboard. |
| **Local `supabase start`** | Use `LOAD_TEST_MAX_VUS=50` for dev; validates scripts and race handling, not production ceilings. |

Bottlenecks to watch:

- Supabase connection count (pooler recommended).
- `start_exam_attempt` + `exam_answers` upsert hot rows on same `attempt_id` (unique per user prevents cross-user contention).
- In-memory IP rate limits in marketing APIs do **not** apply to bearer exam routes.

## Race fix (m20)

Migration `20250528000003_start_attempt_race.sql` uses `ON CONFLICT (exam_id, user_id) DO NOTHING` so duplicate start requests from the same user resolve to a single in-progress attempt.

## Cleanup

Synthetic users use email `loadtest+<timestamp>.<n>@mathsmania.loadtest`. Remove via Supabase Auth dashboard or SQL when finished.
