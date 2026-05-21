# Service Layer (`src/services/`)

Thin orchestration layer that composes validation, business, and database into
`ApiResult<T>`-returning use cases.

## Contract

Every exported function MUST:

1. Accept already-resolved input (no `NextRequest`, no `params`).
2. Call `parseInput(schema, raw)` from `@/validation/parseValidation` before any side effect.
3. Call business rules (`@/business/*`) for calculations or domain checks.
4. Call repositories (`@/database/*`) for persistence — never `supabase.from(...)` directly.
5. Return `ApiResult<T>` from `@/types/common`. Never throw on expected failures.
6. Audit every mutation via `auditRepository.insert(...)`.
7. Refetch the persisted row after every mutation so callers can refresh state.

## Implemented

- `employeeService` — create / update / list / getById / setStatus / activate /
  deactivate / remove (soft + hard) / linkCounts.
- `dutyService` — list / getById / create / update / cancel (soft-delete) /
  checkIn / checkOut. Enforces employee + patient overlap detection, rolls back
  billing service-entries on cancel, recomputes payout after cancel and
  checkout. See test matrix below.
- `attendanceService` — list / getById / create / update / mark (upsert) /
  markPresent / markAbsent / remove / listMissingForEmployee. Enforces
  status-based time clamping, duplicate detection (duty or employee+date),
  payout recompute for the row's YYYY-MM (and the prior month when an edit
  crosses periods), and audit logs every mutation.

## To do (per `REFACTOR_PLAN.md` Phase 5)

- `patientService`
- `inquiryService`
- `billingService`
- `payoutService`
- `reportService`

## Test matrix — `dutyService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Assign duty with valid patient + employee + shift | Returns row, status `SCHEDULED`, audit `create` written | `POST /api/v1/duties` → `dutyService.create` |
| Assign duty overlapping same employee | 409 with `code: duplicate`, `details.field: "employee_window"` | `ensureNoOverlap` (employee branch) |
| Assign duty overlapping same patient | 409 with `code: duplicate`, `details.field: "patient_window"` | `ensureNoOverlap` (patient branch) |
| Edit duty start/end inside window | Updates + writes audit `update` | `PATCH /api/v1/duties/[id]` |
| Edit a `COMPLETED` duty back to `SCHEDULED` | 422, `code: business_rule_violation` | `canReopenCompletedDuty` |
| Cancel a duty with no billing | Status `CANCELLED`, audit `delete`, payout recomputed | `POST /api/v1/duties/[id]/cancel` |
| Cancel a duty whose billing already has receipts | 409, refuses to corrupt finance data | `canCancelDutyWithBilling` |
| Cancel a duty whose billing has only service entries | Service entries deleted, status `CANCELLED` | `rollbackBillingFromDuty` |
| Check-in duty | Attendance upserted, duty `IN_PROGRESS` | `POST /api/v1/duties/[id]/check-in` |
| Check-out without prior check-in | 400 `bad_request` | `dutyService.checkOut` |
| Check-out with check-in | Hours computed, duty `COMPLETED`, payout recomputed for duty's month | `dutyService.checkOut` |
| Refresh page after each mutation | All routes refetch from DB and return the persisted row so the client just re-renders | `loadFreshDuty` |

## Test matrix — `attendanceService`

| Scenario | Expected | Covered by |
| --- | --- | --- |
| Mark Present (no existing row) | New row created, status `PRESENT`, `hours` populated, payout recomputed | `POST /api/v1/attendance/mark` → `attendanceService.mark` → `create` |
| Mark Present twice for same duty | Second call updates the existing row, no duplicate created | `attendanceService.mark` upsert branch |
| Mark Absent | New row, `check_in_at` / `check_out_at` = null, `hours` = 0, payout recomputed | `attendanceService.markAbsent` |
| Create with status `PRESENT` but no check-in / no duty | 422 `business_rule_violation` ("PRESENT/LATE/HALF_DAY attendance needs check_in_at or duty_id") | `ensureAttendanceHasAnchor` |
| Create with `check_out_at <= check_in_at` | 422 `validation_error` | Zod cross-field guard |
| Create with `status: ABSENT` but `check_out_at` set | 422 `validation_error` | Zod cross-field guard |
| POST duplicate attendance for same `duty_id` | 409 `duplicate` with `details.field: "duty_id"` | `checkDuplicate` + UQ constraint surfacing |
| POST second attendance for same `employee_id` + same calendar date (no duty) | 409 `duplicate` with `details.field: "employee_date"` | `checkDuplicate` date branch |
| Edit attendance hours | Updates row, recomputes payout for new period, also recomputes prior period if it changed | `attendanceService.update` |
| Delete attendance | Row removed, payout recomputed for its period, audit `delete` written | `attendanceService.remove` |
| `GET /api/v1/attendance/missing?employee_id=&from=&to=` | Returns duties without an attendance row (skipping CANCELLED / NO_SHOW) | `attendanceService.listMissingForEmployee` |
| Refresh page after each mutation | Routes return the refetched persisted row so the client just re-renders | `loadFreshAttendance` |

## Forbidden

- Direct `from("hh_…")` queries.
- Business math (use `src/business`).
- HTTP response building (route handlers wrap the result via `apiResultBridge`).
