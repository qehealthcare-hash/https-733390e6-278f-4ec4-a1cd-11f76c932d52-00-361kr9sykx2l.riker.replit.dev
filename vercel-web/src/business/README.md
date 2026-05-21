# Business Logic Engine (`src/business/`)

Pure functions that encode Hominal Healthcare CRM domain rules. **Stateless.**
No HTTP, no Supabase, no React.

## Contract

- Input: plain objects (parsed and validated).
- Output: either a typed result OR an `ApiResult<T>` failure for business-rule
  violations (`code: "business_rule_violation"`).
- Deterministic. Same input → same output. Safe to unit-test.

## Files to create (per `REFACTOR_PLAN.md` Phase 4)

- `billingRules.ts` — totals, paid days, unpaid days, security deposit math, range slicing.
- `payoutRules.ts` — monthly payout aggregation, advance/deduction/bonus logic.
- `dutyRules.ts` — shift type, overlap prevention, calendar expansion.
- `attendanceRules.ts` — present/absent/half-day rules.
- `patientRules.ts` — duplicate detection (phone-normalised), active-case rule.
- `reportRules.ts` — dashboard KPIs, P&L, payout reconciliation, inquiry conversion.
- `invoiceRules.ts` — invoice closing, outstanding, line-item generation.
- `idRules.ts` — id prefixes (PID*, INVE*, RECB*, HINV*) — moved out of UI.

## Forbidden

- DB calls.
- HTTP fetch.
- `window` / `document` references.
- Direct mutation of input objects (return new ones).
