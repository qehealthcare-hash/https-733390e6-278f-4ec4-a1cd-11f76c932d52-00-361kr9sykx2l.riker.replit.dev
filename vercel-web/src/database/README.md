# Repository Layer (`src/database/`)

Thin typed wrappers around Supabase `hh_*` tables. **No business logic.**

## Contract

- All clients come from `supabaseClient.ts` (`adminClient`, `userClient`).
- Use `runQuery` / `runListQuery` via `baseRepository` helpers — they convert `{ data, error }` to `ApiResult<T>`.
- Import from `@/database` (barrel in `index.ts`).
- Functions are named by operation: `findById`, `list`, `insert`, `update`, `remove`, etc.

## Files (Phase 2)

| File | Tables / RPCs |
|------|----------------|
| `supabaseClient.ts` | Client factory + `runQuery` |
| `baseRepository.ts` | Shared CRUD primitives |
| `types.ts` | `JsonRow`, `ListQuery`, `DbAccess` |
| `patientRepository.ts` | `hh_patients`, history reads |
| `employeeRepository.ts` | `hh_employees` |
| `inquiryRepository.ts` | `hh_inquiries` |
| `dutyRepository.ts` | `hh_duties` |
| `billingRepository.ts` | `hh_billings`, `hh_receipts`, `hh_svc_entries`, invoices, `hominal_save_receipt` |
| `payoutRepository.ts` | `hh_payouts`, `hh_paid_transactions`, `hh_payout_charges`, `hh_recompute_payout` |
| `attendanceRepository.ts` | `hh_attendance` |
| `reportRepository.ts` | Read-only counts / aggregates |
| `auditRepository.ts` | `hh_audit_logs` (insert + list) |
| `index.ts` | Barrel exports |

## Forbidden in repositories

- Status/billing/payout business rules (`if (status === "Active")`, net amount math, etc.).
- HTTP or Next.js imports.
- Direct `@supabase/supabase-js` outside `supabaseClient.ts`.

## Next (Phase 3+)

Services in `lib/api/services/*.ts` should call these repositories instead of `supabaseAdmin().from(...)` directly.
