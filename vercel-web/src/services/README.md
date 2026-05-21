# Service Layer (`src/services/`)

Thin orchestration layer between API routes and business / database / validation.

## Contract

Every exported function MUST:

1. Accept clean, already-parsed input (no `NextRequest`, no `params`).
2. Call validation (`src/validation/*`) before any side effect.
3. Call business rules (`src/business/*`) for calculations or domain checks.
4. Call repositories (`src/database/*`) for persistence.
5. Return `ApiResult<T>` from `src/types/common`. Never throw on expected failures.

## Files to create (per `REFACTOR_PLAN.md` Phase 5)

- `patientService.ts`
- `employeeService.ts`
- `inquiryService.ts`
- `dutyService.ts`
- `billingService.ts`
- `payoutService.ts`
- `attendanceService.ts`
- `reportService.ts`

## Forbidden

- Direct `from("hh_…")` queries (use repositories).
- Business math (use `src/business`).
- HTTP response building (the route handler wraps the result).
