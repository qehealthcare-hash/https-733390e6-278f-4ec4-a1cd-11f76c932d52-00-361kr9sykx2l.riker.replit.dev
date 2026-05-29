import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  emptyEnsureForm,
  istDayKey
} from "@/lib/payoutUi";

describe("payoutUi", () => {
  it("istDayKey uses IST calendar day", () => {
    expect(istDayKey("2026-05-25T20:00:00.000Z")).toBe("2026-05-26");
  });

  it("currentPeriod returns YYYY-MM", () => {
    expect(currentPeriod()).toMatch(/^\d{4}-\d{2}$/);
  });

  it("emptyEnsureForm defaults period to current month", () => {
    const form = emptyEnsureForm();
    expect(form.period_month).toBe(currentPeriod());
  });
});
