# CRM API clients (frontend service layer)

Pages and hooks talk to the backend through these modules instead of
embedding `/api/v1/...` path strings.

## Stack position

```
React page / hook
   ↓
lib/clients/<domain>Client.ts   ← you are here
   ↓
lib/api-client.ts               (auth header, idempotency, envelope unwrap)
   ↓
app/api/v1/**/route.ts
   ↓
src/services/*
```

## Adding a domain

1. Create `lib/clients/fooClient.ts` with a `FOO_BASE` constant and methods
   that call `request` / `requestWithOfflineFallback`.
2. Export from `lib/clients/index.ts`.
3. Use the client from pages/hooks only — do not import `request` from
   `lib/api-client` in `app/`, `components/`, or non-client `lib/` (ESLint +
   `architecture.boundaries.test.ts` enforce this).

Shared session/types: import `ApiSession` from `@/lib/clients/types`.

## Reference: patients

- `patientsClient.list` — pass to `usePaginatedResource({ list: patientsClient.list })`
- `patientsClient.get / save / close / reopen / hardDelete / history`
- `lookupsClient.employees` — assignment dropdown

See `app/patients/page.tsx`.

Paginated lists use `usePaginatedResource({ list: fooClient.list, ... })`, which
calls `list(session, { limit, offset, ...filters })` — there is no `basePath`
escape hatch on pages.

After login, `auth-provider` flushes queued mutations via `@/lib/offline-queue`.
