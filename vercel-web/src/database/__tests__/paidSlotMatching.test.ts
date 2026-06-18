import { describe, expect, it } from "vitest";

/**
 * Mirrors payoutRepository paid-slot matching (date in paid_dates or range).
 */
function paidTransactionCoversDate(
  tx: { paid_dates?: unknown; from_date?: string; to_date?: string },
  isoDate: string
): boolean {
  const paidDates = tx.paid_dates;
  if (Array.isArray(paidDates) && paidDates.map(String).includes(isoDate)) {
    return true;
  }
  const from = String(tx.from_date || "");
  const to = String(tx.to_date || "");
  return Boolean(from && to && isoDate >= from && isoDate <= to);
}

describe("paid slot matching", () => {
  it("matches explicit paid_dates array", () => {
    expect(
      paidTransactionCoversDate({ paid_dates: ["2026-06-10", "2026-06-11"] }, "2026-06-10")
    ).toBe(true);
    expect(
      paidTransactionCoversDate({ paid_dates: ["2026-06-10"] }, "2026-06-11")
    ).toBe(false);
  });

  it("matches inclusive from/to range", () => {
    expect(
      paidTransactionCoversDate({ from_date: "2026-06-01", to_date: "2026-06-30" }, "2026-06-15")
    ).toBe(true);
    expect(
      paidTransactionCoversDate({ from_date: "2026-06-01", to_date: "2026-06-30" }, "2026-07-01")
    ).toBe(false);
  });
});
