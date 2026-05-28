# Maths Mania — Beyond Numbers

> _"Beyond Numbers, Your Way to Learn."_

The official website and real-time exam platform for **Maths Mania** — an India-first edtech brand teaching school maths (Class 1–10), banking quant (IBPS / SBI / RBI), SSC competitive aptitude, smart shortcut tricks, and running free synchronized All-India live mock exams.

This repository will grow into a production-grade marketing site + auth-gated exam platform across 22 milestones. See the master brief and the milestone build order for the full plan.

---

## Status

**Milestone 22 of 22 — README & production deploy.** ✅ Complete (m1–m22) — **all milestones shipped**

**Milestone 10 — Supabase Auth.** ✅

**Milestone 9 — Supabase foundation.** ✅

Previously shipped through **m8** (resources, blog, self-paced quizzes). **m9** adds:

- SQL migrations: `profiles`, exams platform tables, marketing capture, RLS, `public_merit` view
- `lib/supabase/*` — browser, server, and admin clients
- `lib/database.types.ts` — typed schema (regenerate with `npm run db:types`)
- Dual-write: newsletter + lead APIs use Supabase when `SUPABASE_SERVICE_ROLE_KEY` is set, else jsonl fallback

**Milestone 10 — auth.** ✅

- `/login`, `/signup`, `/verify` (auth), `/onboarding`, `/auth/callback`
- Email magic link + Google OAuth + phone OTP (MSG91 when configured; dev OTP in logs / `000000`)
- `requireAuth()` / `authGuard` server helper, `UserMenu` in navbar
- `/dashboard` — overview stats, upcoming exams, recent attempts, suggested videos
- `/dashboard/exams`, `/dashboard/attempts/[id]`, `/dashboard/profile`, certificates archive
- Certificate verification moved to `/certificates/verify` (auth uses `/verify`)

**Milestone 16 — marketing pages.** ✅

- `/testimonials` — full student stories grid from `content/testimonials.json`
- `/about` — teaching philosophy, stats, Sunday live-exam ritual
- `/contact` — email, WhatsApp (when configured), and `/api/contact` form → `data/contact.jsonl`
- `/privacy` and `/terms` — structured legal copy with in-page table of contents

**Milestone 17 — SEO, performance & accessibility.** ✅

- `app/sitemap.ts` + `app/robots.ts` — public routes, blog/quiz/courses, live exam slugs from Supabase
- `lib/seo.ts` — canonical metadata helper, JSON-LD builders (Organization, Course, Event, Breadcrumbs)
- Structured data on home (FAQ), marketing layout (Organization + WebSite), exams, courses, blog
- `@vercel/analytics` + `@vercel/speed-insights`, `app/manifest.ts`, YouTube `preconnect`
- `noindex` on dashboard, admin, and auth; skip links on dashboard/admin

**Milestone 18 — performance pass.** ✅

- `LazyYouTubeEmbed` — defers playlist iframes until near viewport (course pages)
- Lighter `mqdefault` thumbnails for video grids; AVIF/WebP via `next/image`
- Dynamic import of home video grid + `/videos` library (smaller initial JS)
- `Cache-Control: no-store` on exam attempt/lobby/result and exam APIs
- `npm run perf:lighthouse` — optional Lighthouse script (`lighthouse` + `chrome-launcher` devDeps)

**Milestone 19 — accessibility pass.** ✅

- Exam UI keyboard shortcuts (1–4 / A–D, arrows, `[` `]`, R, C, Shift+digit jump)
- Accessible submit dialog (Radix), radiogroup roving focus, live timer announcements
- `npm run a11y:contrast` — token contrast audit · `npm run a11y:axe` — axe on key routes
- Video card alt text, darker faint text token, auth skip link

**Milestone 20 — load testing.** ✅

- `scripts/loadtest.js` — k6 ramp to 500 VUs, p95 &lt; 400ms target (§14.7)
- `POST /api/exams/attempt/start` + `/answer` — bearer JWT autosave API for k6
- `scripts/loadtest-prepare.mjs` — mint test users + `scripts/.loadtest.env`
- Migration: `start_exam_attempt` race-safe on `(exam_id, user_id)`
- See [docs/LOAD_TEST.md](docs/LOAD_TEST.md)

**Milestone 21 — polish.** ✅

- Custom **404** (maths joke), **500** (`error.tsx` + `global-error.tsx`)
- `/exams/[slug]/not-started` and `/closed` — dedicated exam-window pages
- `EmptyState` + subtle `FadeIn` motion (respects reduced-motion)
- Dashboard and exam hub empty states

**Milestone 22 — deploy.** ✅

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + Supabase + Upstash + cron setup
- `vercel.json` — exam lifecycle cron every 5 minutes
- `GET /api/cron/exam-lifecycle` — status transitions + auto merit publish
- Upstash-backed `rateLimitRequest` + OTP store (in-memory fallback locally)
- Migration `20250528000004` — service_role merit publish + `cron_advance_exam_statuses`

**Milestone 11 — exam admin.** ✅

- `/admin/exams` — list, create, edit exams (admin/moderator role)
- Question editor with live KaTeX preview
- Schedule windows + marking scheme on exam form
- Seed migration: `ibps-quant-speed-test-2` (30 min) + `ssc-cgl-quant-sprint-1` (20 min)

**Milestone 1 — brand foundation.** ✅

**Milestone 2 — navbar + footer + route stubs.** ✅

Currently includes (marketing site):

- Next.js 16 (App Router, TypeScript, Turbopack)
- Tailwind CSS v4 with the full `@theme` token system (oklch palette, radii, shadows, motion)
- next/font: Plus Jakarta Sans (UI), Fraunces (display), JetBrains Mono (numerals)
- Light / system / dark themes via `next-themes` with a segmented pill toggle
- Reusable primitives — `Container`, `Section`, `Eyebrow`, `Heading`, `Button`, `Logo`
- Brand site config (`lib/site.ts`) — single source of truth for name, tagline, socials, pillars
- §2 folder structure scaffolded with `.gitkeep` stubs so subsequent milestones land cleanly

Run it and you should see the brand foundation page that visibly demonstrates every token at work, in both light and dark modes.

---

## Local development

```bash
# Either package manager is fine — pnpm is recommended once you have it installed
npm install
npm run dev

# or
pnpm install
pnpm dev
```

The dev server runs on `http://localhost:3000`.

### Required tooling

| Tool    | Version       | Notes                                          |
| ------- | ------------- | ---------------------------------------------- |
| Node.js | ≥ 20.0 (LTS)  | 22 or 24 recommended.                          |
| npm     | ≥ 10          | Ships with Node.                               |
| pnpm    | ≥ 9 (opt)     | `corepack enable pnpm` once Node is installed. |

### Environment variables

Copy `.env.example` to `.env.local` and fill in values as you reach each milestone. The marketing site runs without Supabase; live exams and auth need it from **m9+**. See `supabase/README.md` for local `supabase start` + `supabase db reset`.

```bash
cp .env.example .env.local
```

---

## Tech stack (locked-in)

| Layer            | Choice                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework        | Next.js 16, App Router, TypeScript, Turbopack                                                                     |
| Styling          | Tailwind CSS v4 + CSS variables (oklch tokens)                                                                    |
| Components       | shadcn/ui primitives (Radix) — added per-milestone                                                                |
| Icons            | `lucide-react`                                                                                                    |
| Animation        | `motion` (Framer Motion v11) — sparingly                                                                          |
| Forms            | `react-hook-form` + `zod` (milestone 6 onwards)                                                                   |
| Database         | Supabase Postgres (milestone 9 onwards)                                                                           |
| Auth             | Supabase Auth — magic-link, Google, phone OTP via MSG91 (milestone 10)                                            |
| Realtime         | Supabase Realtime for exam state, lobby presence, merit list updates (milestone 12+)                              |
| Cache / RL       | Upstash Redis — attempt locks, IP rate limit (milestone 13+)                                                      |
| Math rendering   | KaTeX (milestone 7)                                                                                               |
| PDF generation   | `@react-pdf/renderer` for merit certificates (milestone 14)                                                       |
| Hosting          | Vercel                                                                                                            |

---

## Folder layout (§2 of the brief)

```
app/
  (marketing)/         marketing pages (home, courses, blog, …)
  (auth)/              login, signup, verify, onboarding
  (dashboard)/         auth-required student dashboard
  (admin)/             role='admin'-gated admin panel
  api/
    youtube/           ISR-cached YouTube fetch
    exams/             attempt, answer, submit, heartbeat, merit endpoints
    webhooks/          grading + merit publish webhooks
    time/              server time endpoint for trusted countdowns

components/
  ui/                  base primitives (Container, Section, Heading, Button, …)
  brand/               Logo, future brand-specific motifs
  sections/            marketing sections (Hero, Pillars, FAQ, …)
  exam/                ExamCard, CountdownTimer, ExamPlayer, AntiCheatGuard, …
  quiz/                self-paced quiz player
  dashboard/, admin/, auth/, math/

lib/
  utils.ts             cn, formatINR, assert, formatIndianNumber
  site.ts              brand constants + pillar definitions
  supabase/            client + server + admin SDKs (milestone 9)
  exams/               grading, merit, server-time, anti-cheat helpers
  auth/                session + RBAC helpers

content/
  blog/                MDX posts
  quizzes/             JSON-defined self-paced quizzes
  exams/               JSON seed data for real-time exams

supabase/
  migrations/          numbered SQL migrations
  functions/           edge functions

public/
  brand/               logo files, OG image, favicons
  social/              manually-saved Instagram reel thumbnails
  illustrations/       custom SVG illustrations
```

---

## Adding content

| Content | How |
|---------|-----|
| **Blog post** | Add `content/blog/<slug>.mdx` with frontmatter (`title`, `date`, `excerpt`, `tags`). |
| **Self-paced quiz** | Add `content/quizzes/<slug>.json` — see existing quizzes for schema. |
| **Testimonial** | Edit `content/testimonials.json`. |
| **Live exam** | `/admin/exams/new` — no deploy needed for schedule/content changes. |

### YouTube API key (optional but recommended)

1. [Google Cloud Console](https://console.cloud.google.com/) → enable **YouTube Data API v3**.
2. Create an API key; restrict by HTTP referrer to your domain.
3. Set `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` in `.env.local` / Vercel.

Without a key, `/videos` and home grids show curated placeholders.

---

## Deployment

Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

Quick path:

1. **Supabase** — create project, `supabase db push`, copy URL + keys.
2. **Upstash** — create Redis, copy REST URL + token.
3. **Vercel** — import repo, set **Root Directory** to `maths-mania`, paste env from `.env.example`, set `CRON_SECRET`.
4. Deploy — cron runs automatically via `vercel.json`.

```bash
cd maths-mania
npx vercel --prod
```

---

## Asset checklist (§4.2)

Place before launch:

| Asset | Path |
|-------|------|
| Logo SVG/PNG | `public/brand/logo.svg` |
| OG image (1200×630) | `public/brand/og-image.png` |
| Favicon set | `app/favicon.ico` + `public/brand/` |
| Social reel thumbnails | `public/social/` |
| Hero / pillar illustrations | `public/illustrations/` |

---

## License

Proprietary. © Maths Mania.
