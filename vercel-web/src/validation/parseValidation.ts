import type { ZodType } from "zod";
import type { ApiResult } from "@/types/common";
import { validationFailure } from "@/utils/apiResponse";
import type {
  ListValidationOptions,
  MultiArrayValidationOptions
} from "@/validation/tolerantListValidation";
import {
  sanitizeBillingPatientHistory,
  sanitizeDiaryBatchEnvelope,
  sanitizeListEnvelope,
  sanitizeMultiArrayPayload,
  sanitizeTotalsByBilling,
  type DiaryBatchSanitizeOptions
} from "@/validation/tolerantListValidation";

/**
 * Produce a one-line human-readable summary of a Zod flatten() error, e.g.
 *   "phone: mobile is required; aadhar: Aadhar must be exactly 12 digits"
 *
 * Used as the user-facing `error` message so the form's generic
 * "Validation failed" actually tells the operator which fields are wrong.
 * Field-level details are still included in `details.fieldErrors` for the
 * client to render inline.
 */
function summarizeFlatten(flat: {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
}): string {
  const parts: string[] = [];
  for (const msg of flat.formErrors || []) {
    if (msg) parts.push(msg);
  }
  for (const [field, msgs] of Object.entries(flat.fieldErrors || {})) {
    if (!msgs || !msgs.length) continue;
    parts.push(`${field}: ${msgs.filter(Boolean).join(", ")}`);
  }
  if (!parts.length) return "Validation failed";
  // Cap at ~3 fields in the message; the rest are visible in details so
  // the toast / banner doesn't become a wall of text.
  const visible = parts.slice(0, 3).join("; ");
  const overflow = parts.length > 3 ? ` (+${parts.length - 3} more)` : "";
  return visible + overflow;
}

/** Parse unknown input with a Zod schema; never throws. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): ApiResult<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flat = result.error.flatten();
    return validationFailure(flat, summarizeFlatten(flat));
  }
  return { success: true, data: result.data };
}

/** Parse service output with a Zod schema before serializing to the client. */
export function parseOutput<T>(schema: ZodType<T>, output: unknown): ApiResult<T> {
  const result = schema.safeParse(output);
  if (!result.success) {
    const flat = result.error.flatten();
    return {
      success: false,
      error: "Response validation failed",
      code: "internal_error",
      details: flat
    };
  }
  return { success: true, data: result.data };
}

export type OutputSanitizeOptions =
  | { kind: "list"; list: ListValidationOptions }
  | { kind: "multi"; multi: MultiArrayValidationOptions }
  | {
      kind: "billing_history";
      scope: string;
      billings: ZodType;
      receipts: ZodType;
      invoices: ZodType;
      totals: ZodType;
    }
  | { kind: "diary_batch"; diaryBatch: DiaryBatchSanitizeOptions };

/**
 * Optionally sanitize list payloads row-by-row, then run strict envelope validation.
 * Invalid rows are dropped with a server-side warning — the operator still sees valid data.
 */
export function parseOutputSanitized<T>(
  schema: ZodType<T>,
  output: unknown,
  sanitize?: OutputSanitizeOptions
): ApiResult<T> {
  if (!sanitize) return parseOutput(schema, output);

  let payload = output;
  let dropped = 0;

  if (sanitize.kind === "list") {
    const result = sanitizeListEnvelope(output, sanitize.list);
    payload = result.data;
    dropped = result.dropped.length;
  } else if (sanitize.kind === "multi") {
    const result = sanitizeMultiArrayPayload(output, sanitize.multi);
    payload = result.data;
    dropped = result.dropped.length;
  } else if (sanitize.kind === "billing_history") {
    const result = sanitizeBillingPatientHistory(
      output,
      {
        billings: sanitize.billings,
        receipts: sanitize.receipts,
        invoices: sanitize.invoices
      },
      sanitize.scope
    );
    const totalsDropped = sanitizeTotalsByBilling(result.data, sanitize.totals, sanitize.scope);
    payload = result.data;
    dropped = result.dropped.length + totalsDropped.length;
  } else if (sanitize.kind === "diary_batch") {
    const result = sanitizeDiaryBatchEnvelope(output, sanitize.diaryBatch);
    payload = result.data;
    dropped = result.dropped.length;
  }

  if (dropped > 0) {
    console.warn("[api] response contained invalid rows that were dropped", {
      scope:
        sanitize.kind === "list"
          ? sanitize.list.scope
          : sanitize.kind === "multi"
            ? sanitize.multi.scope
            : sanitize.kind === "diary_batch"
              ? sanitize.diaryBatch.scope
              : sanitize.scope,
      dropped
    });
  }

  return parseOutput(schema, payload);
}
