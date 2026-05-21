/**
 * @deprecated Use `@/services/employeeService` instead.
 *
 * Re-exports kept for backward compatibility with code that imports
 * `employeeSchema` / `employeeService` from this path. New routes use the
 * layered service in `src/services/employeeService.ts`.
 */

export { employeeSchema, type EmployeeInput } from "@/validation/employeeValidation";
export { employeeService } from "@/services/employeeService";
