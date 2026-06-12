import { describe, expect, it } from "vitest";
import { payoutExpectedUpdatedAt } from "@/lib/payoutUi";

describe("payoutUi concurrency helpers", () => {
  it("reads updated_at from payout detail row", () => {
    expect(
      payoutExpectedUpdatedAt({
        payout: { id: "P1", updated_at: "2026-06-01T00:00:00.000Z" }
      } as never)
    ).toBe("2026-06-01T00:00:00.000Z");
  });
});
