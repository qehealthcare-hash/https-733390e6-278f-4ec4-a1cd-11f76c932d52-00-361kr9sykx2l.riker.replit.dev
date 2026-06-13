import { describe, it, expect } from "vitest";
import { detectPayoutDesync } from "@/lib/payoutUi";

describe("detectPayoutDesync — payout must match duty calendar", () => {
  const RATE = 433;

  it("19 duties materialized → recomputed cache of 19 is in sync", () => {
    const live = { gross: 19 * RATE, count: 19 };
    expect(
      detectPayoutDesync({
        liveGross: live.gross,
        liveDutyCount: live.count,
        cachedGross: live.gross,
        cachedDutyCount: live.count,
        status: "OPEN",
        comparable: true
      })
    ).toBe(false);
  });

  it("the Hiruben bug: live 13 duties / 5629 but cache stuck at 1 / 433 is desynced", () => {
    expect(
      detectPayoutDesync({
        liveGross: 5629,
        liveDutyCount: 13,
        cachedGross: 433,
        cachedDutyCount: 1,
        status: "OPEN",
        comparable: true
      })
    ).toBe(true);
  });

  it("deleting a duty row (19 → 18) before recompute is a desync", () => {
    expect(
      detectPayoutDesync({
        liveGross: 18 * RATE,
        liveDutyCount: 18,
        cachedGross: 19 * RATE,
        cachedDutyCount: 19,
        status: "OPEN",
        comparable: true
      })
    ).toBe(true);
  });

  it("after recompute, cache 18 matches live 18 → in sync", () => {
    expect(
      detectPayoutDesync({
        liveGross: 18 * RATE,
        liveDutyCount: 18,
        cachedGross: 18 * RATE,
        cachedDutyCount: 18,
        status: "OPEN",
        comparable: true
      })
    ).toBe(false);
  });

  it("a payout rate change (gross differs, count same) is a desync", () => {
    expect(
      detectPayoutDesync({
        liveGross: 18 * 500,
        liveDutyCount: 18,
        cachedGross: 18 * RATE,
        cachedDutyCount: 18,
        status: "OPEN",
        comparable: true
      })
    ).toBe(true);
  });

  it("disbursements never change gross/count, so they do not cause desync", () => {
    expect(
      detectPayoutDesync({
        liveGross: 8227,
        liveDutyCount: 19,
        cachedGross: 8227,
        cachedDutyCount: 19,
        status: "OPEN",
        comparable: true
      })
    ).toBe(false);
  });

  it("PAID periods are frozen snapshots and are never flagged", () => {
    expect(
      detectPayoutDesync({
        liveGross: 9999,
        liveDutyCount: 25,
        cachedGross: 8227,
        cachedDutyCount: 19,
        status: "PAID",
        comparable: true
      })
    ).toBe(false);
  });

  it("does not flag when the live ledger cannot be compared", () => {
    expect(
      detectPayoutDesync({
        liveGross: 0,
        liveDutyCount: 0,
        cachedGross: 5629,
        cachedDutyCount: 13,
        status: "OPEN",
        comparable: false
      })
    ).toBe(false);
  });
});
