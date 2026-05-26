# E2E tests (Playwright)

## Smoke (no credentials)

Runs against production by default (`PLAYWRIGHT_BASE_URL` or https://crm.hominalhealthcare.com):

```bash
npm run test:e2e:install
npm run test:e2e -- e2e/smoke.spec.ts
```

## Signed-in critical path

Requires a real CRM user:

```bash
export E2E_EMAIL="you@hominalhealthcare.in"
export E2E_PASSWORD="your-password"
npm run test:e2e -- e2e/critical-flow.spec.ts
```

Local dev:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
```
