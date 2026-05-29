# CRM API clients (frontend service layer)

Pages and hooks talk to the backend through these modules instead of
embedding `/api/v1/...` path strings.

## Stack position

```
React page / hook
   ↓
lib/clients/<domain>Client.js   ← you are here
   ↓
lib/api-client.js               (auth header, idempotency, envelope unwrap)
   ↓
app/api/v1/**/route.ts
   ↓
src/services/*
```

## Adding a domain

1. Create `lib/clients/fooClient.js` with a `FOO_BASE` constant and methods
   that call `request` / `requestWithOfflineFallback`.
2. Export from `lib/clients/index.js`.
3. Migrate one page as reference; leave other pages on raw `request()` until
   touched.

## Reference: patients

- `patientsClient.basePath` — pass to `usePaginatedResource({ basePath })`
- `patientsClient.get / save / close / reopen / hardDelete / history`
- `lookupsClient.employees` — assignment dropdown

See `app/patients/page.js`.
