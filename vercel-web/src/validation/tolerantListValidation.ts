import type { ZodType } from "zod";
import { z } from "zod";

export type DroppedRow = {
  index: number;
  id?: string;
  scope: string;
  issues: string;
};

export type ListValidationOptions = {
  rowSchema: ZodType;
  scope: string;
  idField?: string;
};

export type MultiArrayValidationOptions = {
  fields: Array<{ key: string; rowSchema: ZodType; idField?: string }>;
  scope: string;
};

function rowId(row: unknown, idField: string): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const raw = (row as Record<string, unknown>)[idField];
  return raw != null && String(raw).trim() ? String(raw) : undefined;
}

/** Validate each list item; drop invalid rows instead of rejecting the envelope. */
export function parseRowsTolerant<T>(
  rowSchema: ZodType<T>,
  rows: unknown,
  scope: string,
  idField = "id"
): { rows: T[]; dropped: DroppedRow[] } {
  const input = Array.isArray(rows) ? rows : [];
  const valid: T[] = [];
  const dropped: DroppedRow[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const row = input[i];
    const parsed = rowSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      const entry: DroppedRow = {
        index: i,
        id: rowId(row, idField),
        scope,
        issues: parsed.error.issues.map((issue) => issue.message).join("; ") || "invalid row"
      };
      dropped.push(entry);
      console.warn("[api] dropped invalid list row", entry);
    }
  }
  return { rows: valid, dropped };
}

/** Sanitize `{ rows, total, ... }` list envelopes before strict envelope validation. */
export function sanitizeListEnvelope(
  data: unknown,
  options: ListValidationOptions
): { data: Record<string, unknown>; dropped: DroppedRow[] } {
  const raw =
    data && typeof data === "object" ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>) : {};
  const { rows, dropped } = parseRowsTolerant(
    options.rowSchema,
    raw.rows,
    options.scope,
    options.idField || "id"
  );
  const total =
    typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : rows.length;
  return { data: { ...raw, rows, total }, dropped };
}

/** Sanitize multiple named arrays (billing history bundle, report envelopes, …). */
export function sanitizeMultiArrayPayload(
  data: unknown,
  options: MultiArrayValidationOptions
): { data: Record<string, unknown>; dropped: DroppedRow[] } {
  const raw =
    data && typeof data === "object" ? ({ ...(data as Record<string, unknown>) }) : {};
  const allDropped: DroppedRow[] = [];
  const out: Record<string, unknown> = { ...raw };
  for (const field of options.fields) {
    const { rows, dropped } = parseRowsTolerant(
      field.rowSchema,
      raw[field.key],
      `${options.scope}.${field.key}`,
      field.idField || "id"
    );
    out[field.key] = rows;
    allDropped.push(...dropped);
  }
  return { data: out, dropped: allDropped };
}

/** Tolerant parse for billing patient history `{ billings, receipts, invoices, … }`. */
export function sanitizeBillingPatientHistory(
  data: unknown,
  fieldSchemas: {
    billings: ZodType;
    receipts: ZodType;
    invoices: ZodType;
  },
  scope: string
): { data: Record<string, unknown>; dropped: DroppedRow[] } {
  return sanitizeMultiArrayPayload(data, {
    scope,
    fields: [
      { key: "billings", rowSchema: fieldSchemas.billings, idField: "id" },
      { key: "receipts", rowSchema: fieldSchemas.receipts, idField: "id" },
      { key: "invoices", rowSchema: fieldSchemas.invoices, idField: "id" }
    ]
  });
}

/** Drop invalid `totalsByBilling` entries instead of failing the whole bundle. */
export function sanitizeTotalsByBilling(
  data: Record<string, unknown>,
  totalsSchema: ZodType,
  scope: string
): DroppedRow[] {
  const raw = data.totalsByBilling;
  if (!raw || typeof raw !== "object") return [];
  const dropped: DroppedRow[] = [];
  const next: Record<string, unknown> = {};
  for (const [billingId, totals] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = totalsSchema.safeParse(totals);
    if (parsed.success) {
      next[billingId] = parsed.data;
    } else {
      const entry: DroppedRow = {
        index: -1,
        id: billingId,
        scope: `${scope}.totalsByBilling`,
        issues: parsed.error.issues.map((i) => i.message).join("; ") || "invalid totals"
      };
      dropped.push(entry);
      console.warn("[api] dropped invalid totalsByBilling entry", entry);
    }
  }
  data.totalsByBilling = next;
  return dropped;
}

export type DiaryBatchSanitizeOptions = {
  scope: string;
  dutyResultSchema: ZodType;
  entrySchema: ZodType;
};

/**
 * Sanitize POST /duties/diary/batch payloads: drop invalid diary entries per
 * duty instead of rejecting the whole calendar batch.
 */
export function sanitizeDiaryBatchEnvelope(
  data: unknown,
  options: DiaryBatchSanitizeOptions
): { data: Record<string, unknown>; dropped: DroppedRow[] } {
  const raw =
    data && typeof data === "object" ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>) : {};
  const allDropped: DroppedRow[] = [];
  const next: Record<string, unknown> = {};

  for (const [dutyId, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") {
      allDropped.push({
        index: -1,
        id: dutyId,
        scope: `${options.scope}.${dutyId}`,
        issues: "invalid diary result"
      });
      next[dutyId] = { duty_id: dutyId, entries: [], error: "Invalid diary payload" };
      continue;
    }
    const dutyRaw = { ...(value as Record<string, unknown>) };
    const { rows, dropped } = parseRowsTolerant(
      options.entrySchema,
      dutyRaw.entries,
      `${options.scope}.${dutyId}.entries`,
      "date"
    );
    allDropped.push(...dropped);
    dutyRaw.entries = rows;
    if (dutyRaw.duty_id == null || String(dutyRaw.duty_id).trim() === "") {
      dutyRaw.duty_id = dutyId;
    }
    const parsedDuty = options.dutyResultSchema.safeParse(dutyRaw);
    if (parsedDuty.success) {
      next[dutyId] = parsedDuty.data;
    } else {
      allDropped.push({
        index: -1,
        id: dutyId,
        scope: `${options.scope}.${dutyId}`,
        issues:
          parsedDuty.error.issues.map((issue) => issue.message).join("; ") || "invalid diary result"
      });
      next[dutyId] = { duty_id: dutyId, entries: rows, error: "Diary result failed contract validation" };
    }
  }

  return { data: next, dropped: allDropped };
}

export const reportRowsEnvelopeMetaSchema = z.object({
  rows_total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative()
});
