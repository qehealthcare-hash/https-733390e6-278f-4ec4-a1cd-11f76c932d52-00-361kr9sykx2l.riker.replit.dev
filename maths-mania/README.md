# Maths Mania — Beyond Numbers

> _"Beyond Numbers, Your Way to Learn."_

The official website and real-time exam platform for **Maths Mania** — an India-first edtech brand teaching school maths (Class 1–10), banking quant (IBPS / SBI / RBI), SSC competitive aptitude, smart shortcut tricks, and running free synchronized All-India live mock exams.

This repository will grow into a production-grade marketing site + auth-gated exam platform across 22 milestones. See the master brief and the milestone build order for the full plan.

---

## Status

**Milestone 1 of 22 — brand foundation.** ✅ Complete

Currently includes:

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

Copy `.env.example` to `.env.local` and fill in values as you reach each milestone. Nothing in the current milestone requires any env var — every feature degrades gracefully when its key is missing.

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

## Adding content (forward reference)

These workflows will be implemented in later milestones; documenting now so the team knows what to expect.

- **Blog posts (milestone 7):** drop a `slug.mdx` file in `content/blog/`.
- **Self-paced quizzes (milestone 8):** drop a `slug.json` in `content/quizzes/`.
- **Real-time exams (milestone 11):** create via `/admin/exams/new` — no code changes needed.

---

## Deployment

Will be wired up in milestone 22. Target: Vercel + Supabase Production + Upstash Redis + Vercel Cron.

---

## License

Proprietary. © Maths Mania.
