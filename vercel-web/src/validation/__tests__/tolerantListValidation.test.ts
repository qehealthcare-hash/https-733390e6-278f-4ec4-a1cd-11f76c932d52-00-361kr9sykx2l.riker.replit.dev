import { describe, expect, it } from "vitest";
import { z } from "zod";
import { billingListRowDtoSchema, billingTotalsDtoSchema } from "@/validation/billingDto";
import { billingListResponseFixture } from "@/test/billingListFixture";
import { parseOutputSanitized } from "@/validation/parseValidation";
import { parseRowsTolerant } from "@/validation/tolerantListValidation";

describe("tolerantListValidation", () => {
  it("keeps valid rows when one list item has negative receipts (refund)", () => {
    const good = billingListResponseFixture().rows[0];
    const bad = {
      ...good,
      id: "B_BAD_ROW",
      totals: {
        ...(good?.totals || {}),
        receipts: -5000
      }
    };
    const { rows, dropped } = parseRowsTolerant(
      billingListRowDtoSchema,
      [good, bad],
      "test.billings",
      "id"
    );
    expect(rows).toHaveLength(2);
    expect(dropped).toHaveLength(0);
    expect(rows[1]?.totals?.receipts).toBe(-5000);
  });

  it("drops only the invalid row and preserves the rest of the envelope", () => {
    const good = billingListResponseFixture().rows[0];
    const invalid = { id: "!!!bad!!!", patient_id: "P1", status: "Active" };
    const parsed = parseOutputSanitized(
      z.object({
        rows: z.array(billingListRowDtoSchema),
        total: z.number().int().nonnegative()
      }),
      { rows: [good, invalid], total: 2 },
      {
        kind: "list",
        list: { rowSchema: billingListRowDtoSchema, scope: "GET /billings", idField: "id" }
      }
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rows).toHaveLength(1);
      expect(parsed.data.total).toBe(2);
    }
  });

  it("drops invalid totalsByBilling entries without failing the bundle", () => {
    const parsed = parseOutputSanitized(
      z.object({
        billings: z.array(z.record(z.unknown())),
        receipts: z.array(z.record(z.unknown())),
        invoices: z.array(z.record(z.unknown())),
        services: z.array(z.record(z.unknown())),
        totalsByBilling: z.record(z.string(), billingTotalsDtoSchema)
      }),
      {
        billings: [{ id: "B1", patient_id: "P1", status: "Active" }],
        receipts: [],
        invoices: [],
        services: [],
        totalsByBilling: {
          B1: {
            services: 100,
            billed: 100,
            receipts: -50,
            sec_dep: 0,
            discount: 0,
            advance: 0,
            outstanding: 150
          },
          B_BAD: { receipts: "not-a-number" }
        }
      },
      {
        kind: "billing_history",
        scope: "test.history",
        billings: z.object({ id: z.string(), patient_id: z.string(), status: z.string() }),
        receipts: z.object({ id: z.string() }),
        invoices: z.object({ amount: z.number(), received: z.number(), outstanding: z.number(), status: z.string(), invoice: z.record(z.unknown()) }),
        totals: billingTotalsDtoSchema
      }
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data.totalsByBilling)).toEqual(["B1"]);
      expect(parsed.data.totalsByBilling.B1?.receipts).toBe(-50);
    }
  });
});
