# Validation Layer (`src/validation/`)

Zod schemas shared between client forms and server services.

Zod is already a dependency of `vercel-web` (see `package.json`).

## Contract

- Each module exports both the schema and the inferred TS type.
- Services call `schema.safeParse(input)` and convert errors via
  `validationFailure(result.error.flatten())` from `src/utils/apiResponse`.
- Schemas never call DB or business logic.

## Files to create (per `REFACTOR_PLAN.md` Phase 3)

- `commonValidation.ts` — phone, email, currency, dates, pagination.
- `patientValidation.ts`
- `employeeValidation.ts`
- `inquiryValidation.ts`
- `dutyValidation.ts`
- `billingValidation.ts`
- `payoutValidation.ts`
- `attendanceValidation.ts`

## Forbidden

- Cross-imports from `src/services`, `src/business`, `src/database`.
- Throwing — always return a Zod `SafeParseResult`.
