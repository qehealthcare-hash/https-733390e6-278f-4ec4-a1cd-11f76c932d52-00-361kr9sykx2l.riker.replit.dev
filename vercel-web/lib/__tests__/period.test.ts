/**
 * Unit tests for the period helper. (M3-H3)
 *
 * Pinning the IST/UTC behaviour because every dashboard / report
 * surface in the CRM will read these helpers; a silent regression here
 * shows up as "May data on June 1 morning" all over again.
 */

import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  currentPeriod,
  formatPeriodLabel,
  isValidPeriod,
  periodForDate,
  previousPeriod
} from "@/lib/period";

describe("APP_TIMEZONE", () => {
  it("is the IST IANA zone", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("periodForDate (IST)", () => {
  it("returns YYYY-MM in the app timezone", () => {
    // 2026-05-15 10:00 UTC ≈ 15:30 IST — still May.
    expect(periodForDate(new Date("2026-05-15T10:00:00Z"))).toBe("2026-05");
  });

  it("treats early IST hours of a month as the IST month (NOT the UTC month)", () => {
    // 2026-05-31 22:00 UTC = 2026-06-01 03:30 IST. The IST calendar
    // has rolled to June; the helper must agree.
    expect(periodForDate(new Date("2026-05-31T22:00:00Z"))).toBe("2026-06");
  });

  it("treats late UTC-day-end as the IST next month at the boundary", () => {
    // 2026-05-31 18:30 UTC = 2026-06-01 00:00 IST — IST midnight.
    expect(periodForDate(new Date("2026-05-31T18:30:00Z"))).toBe("2026-06");
  });

  it("respects an alternate timezone override", () => {
    expect(periodForDate(new Date("2026-05-31T22:00:00Z"), "UTC")).toBe("2026-05");
  });
});

describe("currentPeriod", () => {
  it("returns a valid YYYY-MM string", () => {
    expect(isValidPeriod(currentPeriod())).toBe(true);
  });
});

describe("previousPeriod", () => {
  it("walks back one month within a year", () => {
    expect(previousPeriod("2026-05")).toBe("2026-04");
  });

  it("wraps the year on January", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });

  it("falls back to current period on invalid input", () => {
    expect(isValidPeriod(previousPeriod("not-a-period"))).toBe(true);
    expect(isValidPeriod(previousPeriod(""))).toBe(true);
  });
});

describe("isValidPeriod", () => {
  it("accepts valid YYYY-MM strings", () => {
    expect(isValidPeriod("2026-05")).toBe(true);
    expect(isValidPeriod("2026-01")).toBe(true);
    expect(isValidPeriod("2026-12")).toBe(true);
  });

  it("rejects out-of-range months and malformed strings", () => {
    expect(isValidPeriod("2026-00")).toBe(false);
    expect(isValidPeriod("2026-13")).toBe(false);
    expect(isValidPeriod("2026-5")).toBe(false); // unpadded
    expect(isValidPeriod("2026/05")).toBe(false);
    expect(isValidPeriod("abc")).toBe(false);
    expect(isValidPeriod("")).toBe(false);
    expect(isValidPeriod(null)).toBe(false);
    expect(isValidPeriod(undefined)).toBe(false);
  });
});

describe("formatPeriodLabel", () => {
  it("renders a human-readable month + year", () => {
    expect(formatPeriodLabel("2026-05")).toBe("May 2026");
    expect(formatPeriodLabel("2025-12")).toBe("December 2025");
  });

  it("returns the input unchanged for malformed strings", () => {
    expect(formatPeriodLabel("nope")).toBe("nope");
  });
});
