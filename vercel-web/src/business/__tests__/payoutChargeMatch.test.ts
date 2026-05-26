import { describe, expect, it } from "vitest";
import {
  payoutChargeInPeriod,
  payoutChargeMatchesEmployee
} from "@/business/payoutChargeMatch";

describe("payoutChargeMatch", () => {
  it("matches partner_id (diary default)", () => {
    expect(
      payoutChargeMatchesEmployee(
        { partner_id: "EMP1", partner: "Manisha Asari" },
        "EMP1"
      )
    ).toBe(true);
  });

  it("matches legacy partner = employee id", () => {
    expect(payoutChargeMatchesEmployee({ partner: "EMP1" }, "EMP1")).toBe(true);
  });

  it("does not match display name only without partner_id", () => {
    expect(
      payoutChargeMatchesEmployee({ partner: "Manisha Asari", partner_id: "" }, "EMP1")
    ).toBe(false);
  });

  it("matches remarks fallback when partner empty", () => {
    expect(
      payoutChargeMatchesEmployee({ partner: "", remarks: "duty EMP1 slot" }, "EMP1")
    ).toBe(true);
  });

  it("buckets charge into YYYY-MM by date or created_at", () => {
    expect(
      payoutChargeInPeriod({ date: "2026-05-15", created_at: "2026-04-01" }, "2026-05")
    ).toBe(true);
    expect(
      payoutChargeInPeriod({ date: "", created_at: "2026-05-01T00:00:00Z" }, "2026-05")
    ).toBe(true);
    expect(payoutChargeInPeriod({ date: "2026-04-30" }, "2026-05")).toBe(false);
  });
});
