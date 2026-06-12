import { describe, expect, it, vi } from "vitest";
import {
  employeeLeaveDateMin,
  inquiryFollowupDateMin,
  ledgerBackdatedDateMax,
  patientStartDateMax
} from "@/lib/dateFieldBounds";

vi.mock("@/src/utils/crmToday", () => ({
  crmTodayIso: () => "2026-06-01"
}));

describe("dateFieldBounds (P2-8)", () => {
  it("employeeLeaveDateMin returns join date when set", () => {
    expect(employeeLeaveDateMin("2024-01-15")).toBe("2024-01-15");
    expect(employeeLeaveDateMin("")).toBeUndefined();
  });

  it("inquiry follow-up min is today", () => {
    expect(inquiryFollowupDateMin()).toBe("2026-06-01");
  });

  it("ledger and patient caps are today", () => {
    expect(ledgerBackdatedDateMax()).toBe("2026-06-01");
    expect(patientStartDateMax()).toBe("2026-06-01");
  });
});
