/**
 * Cross-cutting utilities — no domain knowledge, no IO.
 *
 *   - `apiResponse`  — success/failure helpers wrapping the canonical
 *                      `{ success, data?, error?, code?, details? }` envelope.
 *   - `crmToday`     — Asia/Kolkata "today" helpers shared across services.
 *   - `errorHandler` — repository-side error normalisation.
 *
 * Import from `@/utils` rather than reaching into individual files so the
 * available surface stays explicit.
 */

export * from "@/utils/apiResponse";
export * from "@/utils/crmToday";
export * from "@/utils/errorHandler";
export * from "@/utils/money";
export * from "@/utils/ledgerIds";
