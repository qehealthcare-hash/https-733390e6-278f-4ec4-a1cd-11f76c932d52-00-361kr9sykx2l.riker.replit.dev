import { describe, expect, it } from "vitest";
import { currentPeriod, periodFromMonthInput, reportTabClass } from "@/lib/reportUi";

describe("reportUi", () => {
  it("currentPeriod returns YYYY-MM", () => {
    expect(currentPeriod()).toMatch(/^\d{4}-\d{2}$/);
  });

  it("periodFromMonthInput accepts valid month", () => {
    expect(periodFromMonthInput("2026-05")).toBe("2026-05");
  });

  it("periodFromMonthInput falls back for invalid input", () => {
    expect(periodFromMonthInput("bad")).toBe(currentPeriod());
  });

  it("reportTabClass marks active tab", () => {
    expect(reportTabClass(true)).toContain("primary");
    expect(reportTabClass(false)).toContain("secondary");
  });
});
