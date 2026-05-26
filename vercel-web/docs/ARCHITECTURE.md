# Hominal CRM — Architecture & Layering Contract

_Locked in 2026-05-26. Enforced by ESLint
(`.eslintrc.json` → `no-restricted-imports`) and by
`src/integration/__tests__/architecture.boundaries.test.ts`._

## The five layers

```
┌──────────────────────────────────────────────────────────────────┐
│  app/api/v1/**/route.ts        HTTP handlers (thin)              │
│  ──  withAuth/withoutAuth, requireRole, parseJsonBody            │
│  ──  toServiceContext(actor) → ServiceContext                    │
│  ──  service.method(input, ctx) → ApiResult<T>                   │
│  ──  return respond(result)                                      │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  src/services/<name>Service.ts                                   │
│  Orchestrates validation + business + repository.                │
│  Always returns Promise<ApiResult<T>> — never throws.            │
│  May call external APIs (OpenAI, Meta) directly.                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  src/business/<name>Rules.ts                                     │
│  Pure functions: validation predicates, state-machine guards,    │
│  totals, IDs. No IO. No Next.js. No Supabase.                    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  src/database/<name>Repository.ts                                │
│  Supabase access via baseRepository / supabaseClient helpers.    │
│  Returns ApiResult<T>. Never touches services or validation.     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase (Postgres + Storage + Auth)                            │
└──────────────────────────────────────────────────────────────────┘
```

Cross-cutting:

- `src/validation/<name>Validation.ts` — Zod schemas; called from services with `safeParse` to return `validationFailure(...)`.
- `src/utils/` — `apiResponse` (envelope helpers), `crmToday`, `errorHandler`.
- `src/types/` — `common.ts` (ApiResult, ErrorCodes, Paged, AppRole), `serviceActor.ts` (ServiceActor, ServiceContext).
- `lib/api/` — HTTP-layer helpers (handler, auth, errors, supabase, apiResultBridge, serviceContext, idempotency, env). **Used only from routes, never from services.**

## Allowed import edges

| From → | Allowed | Forbidden |
| --- | --- | --- |
| `app/api/v1/**/route.ts` | `@/lib/api/*`, `@/services/*`, `@/utils/*`, `@/types/*` | `@/lib/api/supabase`, `@/database/*`, `@/lib/api/services/*` (deleted), direct `from(...)` chains |
| `src/services/*` | `@/validation/*`, `@/business/*`, `@/database/*`, `@/utils/*`, `@/types/*`, `@/lib/api/env` (env vars only), external `fetch` for upstream APIs | `@/lib/api/supabase`, `@/lib/api/services/*`, direct Supabase clients |
| `src/business/*` | `@/types/*`, `@/utils/*`, other `@/business/*` | `@/lib/api/*`, `@/database/*`, `@/services/*`, `next/*`, `node:fs`/IO |
| `src/database/*` | `@/database/*` (peers + base), `@/types/*`, `@/utils/*`, `@/business/*` (pure helpers only, e.g. `patientNameKey`) | `@/services/*`, `@/validation/*`, `next/*` |
| `src/validation/*` | `zod`, `@/business/*` pure helpers, `@/types/*` | `@/lib/api/*`, `@/database/*`, `@/services/*` |

## Canonical types

- **`ApiResult<T>`** (`@/types/common`) — the only thing services and repositories return.
- **`ServiceActor`** (`@/types/serviceActor`) — the actor passed into every service. Routes call `toServiceContext(actor)` from `@/lib/api/serviceContext` to project the HTTP-layer `ActorContext` down to a `ServiceContext`.
- **`ServiceContext`** (`@/types/serviceActor`) — `{ actor, accessToken? }`. Use this as the second parameter of every service method.
- Per-service `XxxServiceContext` interfaces (e.g. `BillingServiceContext`) all extend the canonical `ServiceContext` shape and exist for source-compat; new code can import `ServiceContext` directly.

## Response envelope

Every route returns:

```json
{ "success": true, "data": { ... } }
```

or, on failure:

```json
{ "success": false, "error": "...", "code": "validation_error", "details": { ... } }
```

Routes call `respond(result)` from `@/lib/api/apiResultBridge`. The bridge maps `result.code` → HTTP status (422 for validation_error, 404 for not_found, 409 for duplicate/conflict, 502 for upstream_error, 503 for audit_write_failed, etc.). Two intentional exceptions are documented inline:

- `GET /api/v1/whatsapp/webhook` echoes the raw `hub.challenge` text to satisfy Meta's protocol.
- `POST /api/v1/whatsapp/webhook` short-circuits 401 / 400 as plain text for the same reason; the success path uses `respond()`.

## How the layers compose (concrete example)

```ts
// app/api/v1/doctors/route.ts
export const POST = withAuth(async (req, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await doctorService.create(body, toServiceContext(actor));
  return respond(result, 201);
});

// src/services/doctorService.ts
async create(input: unknown, ctx: ServiceContext) {
  const parsed = doctorCreateSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error.flatten());
  const seq = await doctorRepository.listForSequence({ accessToken: ctx.accessToken });
  if (!seq.success) return passFailure(seq);
  const row = { id: nextDoctorId(seq.data), ...buildPayload(parsed.data) };
  const inserted = await doctorRepository.insert(row, { accessToken: ctx.accessToken });
  if (!inserted.success) return passFailure(inserted);
  return success(decorate(inserted.data));
}

// src/database/doctorRepository.ts
insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
  return insertRow("hh_doctors", row, "doctor", opts);
}
```

## Enforcement

1. **ESLint** (`.eslintrc.json` `overrides[]`) — every layer has a `no-restricted-imports` rule that fails the build on a forbidden edge (e.g. a route importing `@/lib/api/supabase`).
2. **Architecture tests** (`src/integration/__tests__/architecture.boundaries.test.ts`) — scans the source tree and asserts:
   - The deleted `lib/api/services/` directory has not come back.
   - No `app/api/**/route.ts` imports Supabase, repositories, or legacy services.
   - No `src/services/*` imports Supabase directly.
   - `src/business/*` is pure (no Supabase, no repos, no Next, no services).
   - `src/database/*` does not import services, validation, or Next.
   - Every `<name>Service.ts` exports a `<name>Service` constant.
   - The barrel files re-export every service and repository.
3. **CI** (`.github/workflows/vercel-web-ci.yml`) runs `npm run typecheck` and `npm test`, which include the architecture tests above.

## What changed in the 2026-05-26 lockdown

- Migrated 7 unmigrated domains to the layered stack: **doctors, vendors, settings, lookups, users/roles, AI, WhatsApp**.
- New repositories: `doctorRepository`, `vendorRepository`, `settingsRepository`, `lookupRepository`, `userRepository`, `roleRepository`, `aiRepository`, `whatsappRepository`, `storageRepository`, `healthRepository`.
- New services: `doctorService`, `vendorService`, `settingsService`, `lookupService`, `userService` (includes role CRUD), `aiService`, `whatsappService`, `storageService`, `healthService`.
- New validation: `doctorValidation`, `vendorValidation`, `userValidation`, `settingsValidation`.
- Deleted all 15 legacy `lib/api/services/*.service.ts` shims and the legacy `lib/api/audit.ts` re-export.
- All 21 previously-legacy routes migrated to `respond()` + `ServiceContext`.
- `app/api/v1/uploads/signed-url`, `app/api/v1/uploads/signed-download`, `app/api/v1/health`, and `app/api/v1/auth/me` migrated to the canonical envelope.
- `app/api/v1/cron/duties-extend` switched from `throw serverError(...) + jsonOk(...)` to `respond(success/failure)` so cron observability stays uniform.
- Consolidated actor types: `ActorLike` aliases in every domain service now re-export the canonical `ServiceActor`. `Actor` in `src/types/common.ts` is `@deprecated`.
- Added barrels: `src/utils/index.ts`, completed `src/services/index.ts` (now exports `auditService`, `dutyDiaryService`, `mutationAudit`, plus all migrated services).
- Added `lib/api/serviceContext.ts` (`toServiceContext`, `toServiceActor`) — the only sanctioned bridge between the HTTP-layer `ActorContext` and the domain `ServiceContext`.

## When you add a new domain (cookbook)

1. Add a Zod schema in `src/validation/<name>Validation.ts`. Export from `src/validation/index.ts`.
2. Add a repository in `src/database/<name>Repository.ts`. Compose `baseRepository` helpers; never import Supabase clients directly. Export from `src/database/index.ts`.
3. Add a service in `src/services/<name>Service.ts`. Accept `(input: unknown, ctx: ServiceContext)`, return `Promise<ApiResult<T>>`. Use `validationFailure`, `passFailure`, `notFoundFailure`, etc., from `@/utils/apiResponse`. Always call `writeMutationAudit` on mutations and return `passFailure(audit)` on audit failure. Export from `src/services/index.ts`.
4. Add the route(s) under `app/api/v1/<name>/route.ts`. Use `withAuth` + `requireRole` + `toServiceContext(actor)` + `respond(result)`. Never import `@/lib/api/supabase` or `@/database/*`.
5. Add tests under `src/integration/__tests__/<name>.route.test.ts` and (optionally) RBAC matrix coverage.

The `architecture.boundaries.test.ts` will fail the build if you forget to register the new service/repository in the barrels or accidentally cross a layer line.
