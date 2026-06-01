import { describe, expect, it } from "vitest";
import {
  buildInvoiceSummaries,
  derivePerInvoiceStatus,
  redistributeDepositOverflow
} from "@/business/invoiceRules";
import { canGenerateFinalInvoice } from "@/business/billingRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("invoiceRules — derivePerInvoiceStatus", () => {
  it("treats ₹0 amount as PAID (FINAL closing doc)", () => {
    expect(derivePerInvoiceStatus("UNPAID", 0, 5000)).toBe("PAID");
  });

  it("classifies partial and paid correctly", () => {
    expect(derivePerInvoiceStatus("UNPAID", 6050, 0)).toBe("UNPAID");
    expect(derivePerInvoiceStatus("PARTIAL", 6050, 5000)).toBe("PARTIAL");
    expect(derivePerInvoiceStatus("PAID", 6050, 6050)).toBe("PAID");
    expect(derivePerInvoiceStatus("CANCELLED", 100, 0)).toBe("CANCELLED");
  });
});

describe("invoiceRules — deposit overflow redistribution", () => {
  it("moves FINAL deposit credit onto MONTHLY outstanding", () => {
    const invoices = [
      { id: "INV-M", status: "PARTIAL", amount: 6050, kind: "MONTHLY" },
      { id: "INV-F", status: "PAID", amount: 0, kind: "FINAL" }
    ];
    const receipts = [
      { invoice_id: "INV-M", amount: 5000 },
      { invoice_id: "INV-F", amount: 5000 }
    ];
    const rows = buildInvoiceSummaries(invoices, receipts);
    const monthly = rows.find((r) => String(r.invoice.id) === "INV-M");
    const final = rows.find((r) => String(r.invoice.id) === "INV-F");
    expect(monthly?.received).toBe(6050);
    expect(monthly?.outstanding).toBe(0);
    expect(monthly?.status).toBe("PAID");
    expect(final?.received).toBe(3950);
    expect(final?.status).toBe("PAID");
  });

  it("redistributeDepositOverflow is a no-op without overflow", () => {
    const map = new Map<string, number>([["A", 100]]);
    redistributeDepositOverflow([{ id: "A", amount: 200, status: "UNPAID" }], map);
    expect(map.get("A")).toBe(100);
  });
});

describe("billingRules — canGenerateFinalInvoice", () => {
  it("allows Closed bill with unbilled services or deposit", () => {
    expectOk(
      canGenerateFinalInvoice({
        billingStatus: "Closed",
        invoices: [{ id: "I1", kind: "MONTHLY", amount: 1000, status: "PAID" }],
        servicesTotal: 6050,
        secDep: 0
      })
    );
    expectOk(
      canGenerateFinalInvoice({
        billingStatus: "Active",
        invoices: [],
        servicesTotal: 0,
        secDep: 5000
      })
    );
  });

  it("blocks Cancelled and duplicate FINAL", () => {
    expectFail(
      canGenerateFinalInvoice({
        billingStatus: "Cancelled",
        invoices: [],
        servicesTotal: 100,
        secDep: 0
      }),
      ErrorCodes.business
    );
    expectFail(
      canGenerateFinalInvoice({
        billingStatus: "Active",
        invoices: [{ id: "F1", kind: "FINAL", amount: 0, status: "PAID" }],
        servicesTotal: 100,
        secDep: 5000
      }),
      ErrorCodes.business
    );
  });
});
