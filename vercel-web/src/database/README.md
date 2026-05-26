# Repository Layer (`src/database/`)

Thin typed wrappers around Supabase `hh_*` tables. **No business logic.**

## Contract

- All clients come from `supabaseClient.ts` (`adminClient`, `userClient`).
- Use `runQuery` / `runListQuery` via `baseRepository` helpers — they convert `{ data, error }` to `ApiResult<T>`.
- Import from `@/database` (barrel in `index.ts`).
- Functions are named by operation: `findById`, `list`, `insert`, `update`, `remove`, etc.

## Files

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
| `doctorRepository.ts` | `hh_doctors` |
| `vendorRepository.ts` | `hh_vendors` |
| `settingsRepository.ts` | `hh_app_settings` |
| `lookupRepository.ts` | `hh_patient_lookup`, `hh_employee_lookup`, `hh_roles`, fallbacks |
| `userRepository.ts` | `hh_users` + `hh_roles` (`roleRepository`) |
| `aiRepository.ts` | `hh_ai_conversations`, `hh_ai_messages`, context reads |
| `whatsappRepository.ts` | `hh_whatsapp_messages` |
| `storageRepository.ts` | Supabase Storage signed-URL + `crm_storage_path_in_use` |
| `healthRepository.ts` | Health probe over `hh_users` |
| `index.ts` | Barrel exports |

## Forbidden in repositories

- Status/billing/payout business rules (`if (status === "Active")`, net amount math, etc.).
- HTTP or Next.js imports.
- Direct `@supabase/supabase-js` outside `supabaseClient.ts`.
- Imports from `@/services/*` or `@/validation/*` (one-way layering: services depend on repositories, never the reverse).

The boundary is enforced by `.eslintrc.json` (`no-restricted-imports` on `src/database/**`) and by `src/integration/__tests__/architecture.boundaries.test.ts`.

## See also

- [`vercel-web/docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — full layering contract.
