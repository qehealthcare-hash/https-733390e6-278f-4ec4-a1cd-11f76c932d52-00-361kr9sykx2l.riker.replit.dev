import { describe, expect, it } from "vitest";
import {
  canConvertInquiry,
  canEditInquiry,
  canTransitionInquiryTo,
  findOpenInquiryDuplicate,
  isOpenInquiry,
  isOverdueFollowup
} from "@/business/inquiryRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("inquiryRules — test matrix", () => {
  it("treats Converted / Closed / Lost as not open", () => {
    expect(isOpenInquiry("New")).toBe(true);
    expect(isOpenInquiry("Converted")).toBe(false);
    expect(isOpenInquiry("Closed")).toBe(false);
  });

  it("findOpenInquiryDuplicate matches only open inquiries on phone", () => {
    const rows = [
      { id: "INQ1", phone: "9876543210", status: "Closed" },
      { id: "INQ2", phone: "9876543210", status: "New" }
    ];
    expect(findOpenInquiryDuplicate(rows, "9876543210")?.id).toBe("INQ2");
    expect(findOpenInquiryDuplicate(rows, "9876543210", "INQ2")).toBeNull();
  });

  it("rejects edit on Converted inquiry", () => {
    const result = canEditInquiry("Converted");
    expectFail(result, ErrorCodes.business);
  });

  it("allows edit on open inquiry", () => {
    expectOk(canEditInquiry("FollowUp"));
  });

  it("rejects convert on Closed inquiry", () => {
    expectFail(canConvertInquiry("Closed", "9999999999"), ErrorCodes.business);
  });

  it("rejects convert without phone", () => {
    expectFail(canConvertInquiry("New", ""), ErrorCodes.business);
  });

  it("rejects transition from Converted", () => {
    expectFail(canTransitionInquiryTo("Converted", "Closed", true), ErrorCodes.business);
  });

  it("requires reason to reopen Closed inquiry", () => {
    expectFail(canTransitionInquiryTo("Closed", "New", false), ErrorCodes.business);
    expectOk(canTransitionInquiryTo("Closed", "New", true));
  });

  it("flags overdue follow-ups for open inquiries only", () => {
    expect(isOverdueFollowup("2020-01-01", "New")).toBe(true);
    expect(isOverdueFollowup("2020-01-01", "Closed")).toBe(false);
    expect(isOverdueFollowup("", "New")).toBe(false);
  });
});
