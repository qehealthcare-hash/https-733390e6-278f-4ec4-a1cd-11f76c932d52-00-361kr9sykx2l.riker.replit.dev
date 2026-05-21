# Validation Layer (`src/validation/`)

Zod schemas shared between API routes, services, and (later) React forms.

## Contract

- Each module exports schemas and inferred types (`PatientInput`, etc.).
- Use `parseInput(schema, body)` from `parseValidation.ts` for non-throwing parses in new code.
- Legacy routes may still call `schema.parse()` via `lib/api/handler` error mapping.
- Schemas never import database, business, or service layers.

## Modules

| File | Schemas |
|------|---------|
| `commonValidation.ts` | `phoneSchema`, `idSchema`, `moneySchema`, `listQuerySchema`, … |
| `patientValidation.ts` | `patientSchema`, `patientAssignSchema` |
| `employeeValidation.ts` | `employeeSchema` |
| `inquiryValidation.ts` | `inquirySchema` (legacy + React field aliases) |
| `dutyValidation.ts` | `dutySchema`, `dutyCheckAtSchema` |
| `billingValidation.ts` | `billingSchema`, `receiptSchema`, `generateFromDutySchema`, … |
| `payoutValidation.ts` | `payoutSchema`, `payoutAdjustmentSchema`, `payoutPaySchema` |
| `attendanceValidation.ts` | `attendanceSchema` |
| `whatsappValidation.ts` | `sendTextSchema`, `sendTemplateSchema`, `sendBillSchema` |
| `aiValidation.ts` | `askSchema` |
| `parseValidation.ts` | `parseInput()` → `ApiResult<T>` |
| `index.ts` | Barrel |

## Backward compatibility

`lib/api/validation.ts` and `lib/api/services/*.ts` re-export schemas so existing imports keep working. New code should use `@/validation` directly.
