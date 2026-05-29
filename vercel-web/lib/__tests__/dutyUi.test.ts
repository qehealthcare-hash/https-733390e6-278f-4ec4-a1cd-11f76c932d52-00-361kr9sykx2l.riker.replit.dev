import { describe, expect, it } from "vitest";

import { dutyTouchesDay, isOpenEndedIso, istDayKey, monthKey } from "@/lib/dutyUi";

describe("dutyUi", () => {
  it("istDayKey uses IST calendar date", () => {
    expect(istDayKey("2026-04-30T18:30:00.000Z")).toBe("2026-05-01");
  });

  it("isOpenEndedIso detects sentinel end date", () => {
    expect(isOpenEndedIso("2099-12-31T00:00:00Z")).toBe(true);
    expect(isOpenEndedIso("2026-05-01T00:00:00Z")).toBe(false);
  });

  it("dutyTouchesDay includes duty on start day", () => {
    expect(
      dutyTouchesDay(
        { start_at: "2026-05-10T02:30:00.000Z", end_at: "2026-05-12T02:30:00.000Z" },
        "2026-05-10"
      )
    ).toBe(true);
  });

  it("dutyTouchesDay shows open-ended duty on every day from start through today", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const tenDaysAgo = new Date();
    tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
    const startIso = tenDaysAgo.toISOString();
    const open = { start_at: startIso };
    // Start day, an intermediate day, and today should all be in-range.
    expect(dutyTouchesDay(open, istDayKey(startIso))).toBe(true);
    expect(dutyTouchesDay(open, today)).toBe(true);
    // A day far in the future (not yet reached) should NOT be in-range.
    expect(dutyTouchesDay(open, "2099-01-01")).toBe(false);
  });

  it("dutyTouchesDay treats sentinel 2099-12-31 end_at as open-ended", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    expect(
      dutyTouchesDay(
        { start_at: "2026-01-01T02:30:00.000Z", end_at: "2099-12-31T00:00:00Z" },
        today
      )
    ).toBe(true);
  });

  it("monthKey formats YYYY-MM", () => {
    expect(monthKey(new Date(2026, 4, 15))).toBe("2026-05");
  });
});
