# Test matrix (Phase 10)

Automated coverage lives under `src/**/__tests__/*.test.ts` and maps to the
scenario tables in `src/services/README.md`.

## Running locally

```bash
cd vercel-web
npm ci
npm run typecheck
npm test
```

Watch mode: `npm run test:watch`.

## What is automated today

| Area | Test file | README section |
| --- | --- | --- |
| Inquiry rules + duplicates | `inquiryRules.test.ts` | inquiryService |
| Inquiry Zod guards | `inquiryValidation.test.ts` | inquiryService |
| Billing close/edit/reopen | `billingRules.test.ts` | billingService |
| Payout lock/adjust/pay | `payoutRules.test.ts` | payoutService |
| Dashboard + P&amp;L math | `reportRules.test.ts` | reportService |
| Audit enforcement | `mutationAudit.test.ts` | Phase 9 |

## CI

`.github/workflows/vercel-web-ci.yml` runs on PRs and `main` pushes that touch
`vercel-web/**`:

1. `npm run typecheck`
2. `npm test` (Vitest, `API_AUDIT_DISABLED=true`)

Deploy workflow (`.github/workflows/deploy-vercel.yml`) is separate; add a
`needs: quality` job there when you want production deploys gated on green CI.

## Not yet automated (integration / E2E)

- Supabase RLS + RPC paths (`hh_convert_inquiry_to_patient`, `hominal_save_receipt`)
- Full HTTP route tests with auth fixtures
- Legacy SPA browser flows (`legacy-crm.html`)
- Playwright smoke against `/login` + `/dashboard`

Add these incrementally behind `INTEGRATION_TEST=1` when a staging Supabase
project is available in CI secrets.
