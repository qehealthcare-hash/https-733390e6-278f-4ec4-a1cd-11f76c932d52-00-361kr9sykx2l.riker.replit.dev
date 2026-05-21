# Hominal CRM API — v1

Next.js Route Handlers in `vercel-web/app/api/v1/*`, deployed to **`crm.hominalhealthcare.com`**.
All endpoints respond with the envelope `{ ok: boolean, data?, code?, message?, details? }`.

## Stack

- **Next.js 15** (Route Handlers, Node runtime)
- **TypeScript** (`tsconfig.json`)
- **Zod** for input validation
- **Supabase** (`@supabase/supabase-js`) — service role on server, anon for the browser
- **Tailwind / React 19** on the UI side (unchanged)

## Auth model

1. Browser signs in with Supabase Auth (email + password).
2. The bearer JWT is sent in `Authorization: Bearer <access_token>` on every API call.
3. The server validates the JWT, then loads the matching active `hh_users` row.
4. RLS policies on `hh_*` tables only allow rows when `hh_is_active_app_user()` returns true.
5. Role gates: `Admin > Manager > Accountant > Staff > Nurse`. Each route declares allowed roles via `requireRole(actor, [...])`.

## Folder structure

```
vercel-web/
├─ app/api/v1/
│  ├─ health/route.ts
│  ├─ inquiries/
│  │  ├─ route.ts                    GET list, POST create
│  │  └─ [id]/
│  │     ├─ route.ts                 GET, PATCH, DELETE
│  │     └─ convert/route.ts         POST convert-to-patient
│  ├─ patients/
│  │  ├─ route.ts                    GET list, POST create
│  │  └─ [id]/
│  │     ├─ route.ts                 GET, PATCH, DELETE (soft)
│  │     ├─ assign/route.ts          POST assign caretaker + shift
│  │     └─ history/route.ts         GET full history
│  ├─ duties/
│  │  ├─ route.ts                    GET list, POST create (no-overlap)
│  │  └─ [id]/
│  │     ├─ route.ts                 GET, PATCH, DELETE (cancel)
│  │     ├─ check-in/route.ts        POST attendance start
│  │     └─ check-out/route.ts       POST attendance end + payout recompute
│  ├─ billings/
│  │  ├─ route.ts                    GET by patient, POST ensure active billing
│  │  ├─ generate/route.ts           POST generate from duty (shift-aware, deduped)
│  │  └─ [id]/
│  │     ├─ status/route.ts          POST status change
│  │     ├─ receipts/route.ts        POST record payment (via RPC)
│  │     └─ invoice/route.ts         GET invoice payload (PDF renders client-side)
│  ├─ payouts/
│  │  ├─ route.ts                    GET list, POST ensure + recompute
│  │  ├─ adjust/route.ts             POST advance/deduction/bonus
│  │  └─ pay/route.ts                POST mark paid + write paid_transactions
│  ├─ ai/
│  │  ├─ ask/route.ts                POST grounded answer
│  │  └─ conversations/
│  │     ├─ route.ts                 GET my conversations
│  │     └─ [id]/route.ts            GET messages
│  └─ whatsapp/
│     ├─ messages/route.ts           GET log
│     ├─ send/route.ts               POST text
│     ├─ send-template/route.ts      POST template
│     ├─ send-bill/route.ts          POST bill link
│     └─ webhook/route.ts            GET verify, POST receipt (no-auth, signed)
└─ lib/api/
   ├─ env.ts               Centralized server env access
   ├─ supabase.ts          supabaseAdmin() + supabaseAsUser()
   ├─ auth.ts              requireActor() + requireRole()
   ├─ errors.ts            ApiError, jsonOk/jsonError, 4xx helpers
   ├─ handler.ts           withAuth / withoutAuth wrappers
   ├─ audit.ts             audit() fire-and-forget writer
   ├─ ids.ts               Compact id generators (legacy-compatible)
   ├─ validation.ts        Shared Zod schemas (phone, email, money, ...)
   └─ services/
      ├─ inquiry.service.ts
      ├─ patient.service.ts
      ├─ duty.service.ts
      ├─ billing.service.ts
      ├─ payout.service.ts
      ├─ ai.service.ts
      └─ whatsapp.service.ts
```

## SQL migration

Run **`hominal_crm_supabase_012_phase4_api_modules.sql`** in the Supabase SQL editor.

The migration is **safe / additive only** — no drops, no truncates. It adds:

- Role + actor helpers (`hh_current_role`, `hh_has_role`, `hh_current_actor`).
- Audit columns + a generic audit trigger that fills `hh_audit_logs` automatically.
- New tables: `hh_duties`, `hh_attendance`, `hh_payouts`, `hh_whatsapp_messages`, `hh_ai_conversations`, `hh_ai_messages`.
- Dedupe constraints (active inquiry per phone, active billing per patient, unique attendance per duty) + a btree_gist exclusion constraint that blocks overlapping non-cancelled duties for the same staff.
- RLS on every new table (`hh_is_active_app_user`). Payout writes are restricted to `Admin / Manager / Accountant`.
- Realtime publication entries for live UI sync.
- `hh_convert_inquiry_to_patient` and `hh_recompute_payout` RPCs.

## Endpoint reference

> All `application/json`. Auth header `Authorization: Bearer <supabase_jwt>` is required unless marked.

### Inquiries — `/api/v1/inquiries`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | any | `?limit`, `?offset`, `?q` |
| POST | `/` | Admin/Manager/Staff | Rejects duplicate active phone |
| GET | `/:id` | any | |
| PATCH | `/:id` | Admin/Manager/Staff | Same dedupe check |
| DELETE | `/:id` | Admin/Manager | Hard delete + audit |
| POST | `/:id/convert` | Admin/Manager/Staff | Idempotent — re-uses existing patient by phone |

### Patients — `/api/v1/patients`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | any | `?status=Active`, `?q`, paging |
| POST | `/` | Admin/Manager/Staff | Dedupe by active phone |
| GET | `/:id` | any | |
| PATCH | `/:id` | Admin/Manager/Staff | |
| DELETE | `/:id` | Admin/Manager | Soft close → `status=Closed` |
| POST | `/:id/assign` | Admin/Manager/Staff | `{ caretaker_id, shift }` |
| GET | `/:id/history` | any | Billings + receipts + duties + audit |

### Duties — `/api/v1/duties`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | any | `?employee_id`, `?patient_id`, `?from`, `?to` |
| POST | `/` | Admin/Manager/Staff | Rejects overlapping duty for the same staff |
| GET | `/:id` | any | |
| PATCH | `/:id` | Admin/Manager/Staff | Overlap recheck on update |
| DELETE | `/:id` | Admin/Manager | Sets `status=CANCELLED` |
| POST | `/:id/check-in` | Admin/Manager/Staff/Nurse | Creates `hh_attendance`, moves status to `IN_PROGRESS` |
| POST | `/:id/check-out` | Admin/Manager/Staff/Nurse | Closes attendance, recomputes payout for the period |

### Billings — `/api/v1/billings`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/?patient_id=` | any | Returns billings + receipts + services |
| POST | `/` | Admin/Manager/Accountant | Ensures one active billing per patient |
| POST | `/generate` | Admin/Manager/Accountant | From `{ duty_id, service_name?, rate_overrides? }`; idempotent on `remarks=duty:<id>` |
| POST | `/:id/status` | Admin/Manager/Accountant | `{ status }` |
| POST | `/:id/receipts` | Admin/Manager/Accountant/Staff | Calls `hominal_save_receipt` RPC |
| GET | `/:id/invoice` | any | Payload for PDF renderer |

### Payouts — `/api/v1/payouts`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | any | `?period=YYYY-MM`, `?employee_id`, `?status` |
| POST | `/` | Admin/Manager/Accountant | Ensures one row per `(employee, period)` via `hh_recompute_payout` |
| POST | `/adjust` | Admin/Accountant | `{ payout_id, advance?, deduction?, bonus?, remarks? }` |
| POST | `/pay` | Admin/Accountant | `{ payout_id, paid_on?, method?, photo? }` + writes `hh_paid_transactions` |

### AI Assistant — `/api/v1/ai`

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/ask` | any | `{ question, scope, conversation_id?, context_id? }`. Server-side OpenAI call only. |
| GET | `/conversations` | any | My conversations |
| GET | `/conversations/:id` | any | Messages |

### WhatsApp — `/api/v1/whatsapp`

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/messages` | any | Log |
| POST | `/send` | Admin/Manager/Staff | Plain text |
| POST | `/send-template` | Admin/Manager/Staff | Meta-approved template |
| POST | `/send-bill` | Admin/Manager/Accountant/Staff | Bill link convenience |
| GET | `/webhook` | none | Meta verification handshake |
| POST | `/webhook` | none | Inbound delivery / read receipts |

## Environment variables

See `vercel-web/.env.example`. Set in Vercel → Project Settings → Environment Variables:

| Key | Where |
|---|---|
| `SUPABASE_URL` | Server + browser (`NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server only |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | Server only |

## Manual test checklist

After running the SQL migration and setting env vars:

| # | Flow | How |
|---|---|---|
| 1 | Inquiry → patient | `POST /inquiries` → `POST /inquiries/:id/convert` → GET `/patients/:id` |
| 2 | Patient → duty | `POST /patients/:id/assign` → `POST /duties` |
| 3 | Duty → billing | `POST /billings/generate` with duty id — re-run returns `duplicate:true` |
| 4 | Duty → payout | `POST /duties/:id/check-out` → `GET /payouts?employee_id=...` shows updated gross |
| 5 | Billing payment | `POST /billings/:id/receipts` → `GET /billings/:id/invoice` shows updated outstanding |
| 6 | Refresh persistence | Reload page after each — rows must remain (Phase 3 already guarantees this in the legacy UI) |
| 7 | No duplicates | Repeat any POST with the same key — must 409 |
| 8 | Mobile + desktop | Open on a phone + desktop browser, both signed in as the same user; realtime channels keep both in sync |

## Audit & compliance

- Every service writes `hh_audit_logs` via `audit()`.
- A DB trigger also writes audit rows on direct table changes, so server-side or admin-tool writes are also captured.
- Set `API_AUDIT_DISABLED=true` only in CI.

## Notes

- `app/api/v1/billings/[id]/invoice` returns the data; the PDF is generated client-side using the existing jsPDF templates in `legacy-crm.html`. To switch to server-side PDFs later, add `@react-pdf/renderer` and a new route — the payload contract is already stable.
- `whatsapp/webhook` does **not** check Meta's `X-Hub-Signature-256` yet. Add HMAC verification before going live in production.
- Realtime subscriptions remain on the existing browser client (`lib/supabase/browser.js`) — no change required.
