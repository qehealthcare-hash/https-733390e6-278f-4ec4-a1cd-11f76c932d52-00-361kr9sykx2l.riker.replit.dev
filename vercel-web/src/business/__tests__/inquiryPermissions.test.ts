import { describe, expect, it } from "vitest";
import { buildInquiryPermissions } from "@/business/inquiryRules";

describe("buildInquiryPermissions", () => {
  it("opens all open-state actions for a New inquiry with a phone", () => {
    const perms = buildInquiryPermissions({ status: "New", phone: "9999999999" });
    expect(perms.canEdit).toBe(true);
    expect(perms.canConvert).toBe(true);
    expect(perms.canClose).toBe(true);
    expect(perms.canDelete).toBe(true);
    expect(perms.canReopen).toBe(false);
    expect(perms.blockReasons?.canReopen).toMatch(/cannot reopen/i);
  });

  it("blocks convert when phone is missing", () => {
    const perms = buildInquiryPermissions({ status: "New", phone: "" });
    expect(perms.canConvert).toBe(false);
    expect(perms.blockReasons?.canConvert).toMatch(/mobile/i);
  });

  it("locks edit + convert on a Converted inquiry", () => {
    const perms = buildInquiryPermissions({ status: "Converted", phone: "9999999999" });
    expect(perms.canEdit).toBe(false);
    expect(perms.canConvert).toBe(false);
    expect(perms.canClose).toBe(false);
    expect(perms.canReopen).toBe(false);
    expect(perms.canDelete).toBe(false);
    expect(perms.blockReasons?.canConvert).toMatch(/already been converted/i);
  });

  it("allows reopen but not double-close on a Closed inquiry", () => {
    const perms = buildInquiryPermissions({ status: "Closed", phone: "9999999999" });
    expect(perms.canClose).toBe(false);
    expect(perms.canReopen).toBe(true);
    expect(perms.canConvert).toBe(false);
  });

  it("treats Lost like Closed for reopen / close gating", () => {
    const perms = buildInquiryPermissions({ status: "Lost", phone: "9999999999" });
    expect(perms.canClose).toBe(false);
    expect(perms.canReopen).toBe(true);
  });

  it("hardDelete flag is always state-allowed (RBAC enforces it)", () => {
    expect(buildInquiryPermissions({ status: "New" }).canHardDelete).toBe(true);
    expect(buildInquiryPermissions({ status: "Converted" }).canHardDelete).toBe(true);
    expect(buildInquiryPermissions({ status: "Closed" }).canHardDelete).toBe(true);
  });
});
