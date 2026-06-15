import { describe, expect, it } from "vitest";
import {
  invoiceLineSvcEntryRefs,
  isUuidString,
  legacyBigintSvcEntryId
} from "@/utils/ledgerIds";

describe("ledgerIds", () => {
  const uuid = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

  it("detects uuid strings", () => {
    expect(isUuidString(uuid)).toBe(true);
    expect(isUuidString("DTY2026050001")).toBe(false);
  });

  it("legacyBigintSvcEntryId accepts safe integers only", () => {
    expect(legacyBigintSvcEntryId(42)).toBe(42);
    expect(legacyBigintSvcEntryId("99")).toBe(99);
    expect(legacyBigintSvcEntryId(uuid)).toBe(null);
  });

  it("invoiceLineSvcEntryRefs maps uuid without Number() coercion", () => {
    expect(invoiceLineSvcEntryRefs(uuid)).toEqual({
      svc_entry_id: null,
      svc_entry_uuid: uuid
    });
    expect(invoiceLineSvcEntryRefs(12)).toEqual({
      svc_entry_id: 12,
      svc_entry_uuid: null
    });
    expect(Number(uuid)).toBeNaN();
  });
});
