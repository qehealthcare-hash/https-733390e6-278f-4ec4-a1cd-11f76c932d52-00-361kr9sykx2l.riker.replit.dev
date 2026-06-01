import { describe, expect, it } from "vitest";
import { buildDutyPermissions } from "@/business/dutyRules";

describe("buildDutyPermissions", () => {
  it("allows full editing for a SCHEDULED duty", () => {
    const perms = buildDutyPermissions({ status: "SCHEDULED" });
    expect(perms.canEdit).toBe(true);
    expect(perms.canCancel).toBe(true);
    expect(perms.canCheckIn).toBe(true);
    expect(perms.canCheckOut).toBe(false);
    expect(perms.canMaterialize).toBe(true);
    expect(perms.canHardDelete).toBe(true);
  });

  it("blocks check-in / allows check-out while IN_PROGRESS", () => {
    const perms = buildDutyPermissions({ status: "IN_PROGRESS", hasCheckIn: true });
    expect(perms.canCheckIn).toBe(false);
    expect(perms.canCheckOut).toBe(true);
    expect(perms.canEdit).toBe(true);
    expect(perms.canCancel).toBe(true);
    expect(perms.canMaterialize).toBe(true);
  });

  it("requires a check-in record for check-out even when IN_PROGRESS", () => {
    const perms = buildDutyPermissions({ status: "IN_PROGRESS", hasCheckIn: false });
    expect(perms.canCheckOut).toBe(false);
    expect(perms.blockReasons?.canCheckOut).toMatch(/check-in/i);
  });

  it("locks edits and cancellation on COMPLETED duties", () => {
    const perms = buildDutyPermissions({ status: "COMPLETED" });
    expect(perms.canEdit).toBe(false);
    expect(perms.canCancel).toBe(false);
    expect(perms.canCheckIn).toBe(false);
    expect(perms.canCheckOut).toBe(false);
    expect(perms.canMaterialize).toBe(false);
    expect(perms.blockReasons?.canEdit).toBeTruthy();
  });

  it("treats CANCELLED duties as terminal", () => {
    const perms = buildDutyPermissions({ status: "CANCELLED" });
    expect(perms.canEdit).toBe(false);
    expect(perms.canCancel).toBe(false);
    expect(perms.canMaterialize).toBe(false);
    expect(perms.blockReasons?.canCancel).toMatch(/already cancelled/i);
  });

  it("blocks cancellation when receipts exist on the billing", () => {
    const perms = buildDutyPermissions({
      status: "SCHEDULED",
      hasBillingServiceLine: true,
      hasActiveReceiptOnBilling: true
    });
    expect(perms.canCancel).toBe(false);
    expect(perms.blockReasons?.canCancel).toMatch(/receipts/i);
  });

  it("allows cancellation when a service line exists but no receipts yet", () => {
    const perms = buildDutyPermissions({
      status: "SCHEDULED",
      hasBillingServiceLine: true,
      hasActiveReceiptOnBilling: false
    });
    expect(perms.canCancel).toBe(true);
    expect(perms.blockReasons?.canCancel).toBeUndefined();
  });
});
