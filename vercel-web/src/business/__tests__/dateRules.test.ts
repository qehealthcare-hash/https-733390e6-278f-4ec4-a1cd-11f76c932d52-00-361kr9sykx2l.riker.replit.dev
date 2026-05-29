import { describe, expect, it } from "vitest";
import {
  monthRangeUTC,
  payoutPeriodFromTimestamp
} from "@/business/dateRules";

describe("dateRules.payoutPeriodFromTimestamp (IST-aware)", () => {
  it("returns YYYY-MM in IST for a UTC timestamp inside the same IST month", () => {
    expect(payoutPeriodFromTimestamp("2026-05-15T10:00:00Z")).toBe("2026-05");
  });

  it("rolls a 18:30 UTC Apr 30 into the IST May payout period", () => {
    // 18:30 UTC on Apr 30 is 00:00 IST on May 1.
    // The legacy `iso.slice(0, 7)` returned "2026-04" and recomputed
    // the wrong payslip for any duty crossing the IST month boundary.
    expect(payoutPeriodFromTimestamp("2026-04-30T18:30:00Z")).toBe("2026-05");
  });

  it("keeps the same IST month for late-evening UTC timestamps inside the month", () => {
    // 22:00 UTC May 31 = 03:30 IST Jun 1 → June period.
    expect(payoutPeriodFromTimestamp("2026-05-31T22:00:00Z")).toBe("2026-06");
    // 12:00 UTC May 31 = 17:30 IST May 31 → May period.
    expect(payoutPeriodFromTimestamp("2026-05-31T12:00:00Z")).toBe("2026-05");
  });

  it("returns empty string for null/empty/invalid input (no silent fallback to today)", () => {
    expect(payoutPeriodFromTimestamp(null)).toBe("");
    expect(payoutPeriodFromTimestamp(undefined)).toBe("");
    expect(payoutPeriodFromTimestamp("")).toBe("");
    expect(payoutPeriodFromTimestamp("not-a-date")).toBe("");
  });
});

describe("dateRules.monthRangeUTC", () => {
  it("returns inclusive-exclusive UTC bounds for the month", () => {
    const r = monthRangeUTC("2026-05");
    expect(r.period).toBe("2026-05");
    expect(r.startISO).toBe("2026-05-01T00:00:00.000Z");
    expect(r.endISO).toBe("2026-06-01T00:00:00.000Z");
  });
});
