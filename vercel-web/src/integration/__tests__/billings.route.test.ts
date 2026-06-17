/**
 * Integration test: billing API surface.
 *
 * - GET /billings: BILLING_READ_ROLES gate + bundle vs paginated branching.
 * - POST /billings: write roles.
 * - POST /billings/[id]/close.
 * - GET/POST /billings/[id]/receipts.
 * - GET/POST /billings/[id]/invoices.
 * - GET/DELETE /billings/[id]/invoices/[invoiceId].
 * - POST /billings/[id]/invoices/[invoiceId]/regenerate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/billingService", () => ({
  billingService: {
    list: vi.fn(),
    listByPatient: vi.fn(),
    create: vi.fn(),
    close: vi.fn(),
    listReceiptsForBilling: vi.fn(),
    recordPayment: vi.fn(),
    listInvoices: vi.fn(),
    generateInvoice: vi.fn(),
    getInvoice: vi.fn(),
    cancelInvoice: vi.fn(),
    regenerateInvoice: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { billingService } from "@/services/billingService";
import { billingSummaryFixture } from "@/test/billingSummaryFixture";

import {
  GET as BillingsGet,
  POST as BillingsPost
} from "../../../app/api/v1/billings/route";
import { POST as BillingClosePost } from "../../../app/api/v1/billings/[id]/close/route";
import {
  GET as BillingReceiptsGet,
  POST as BillingReceiptsPost
} from "../../../app/api/v1/billings/[id]/receipts/route";
import {
  GET as InvoicesGet,
  POST as InvoicesPost
} from "../../../app/api/v1/billings/[id]/invoices/route";
import {
  GET as InvoiceGet,
  DELETE as InvoiceDelete
} from "../../../app/api/v1/billings/[id]/invoices/[invoiceId]/route";
import { POST as InvoiceRegeneratePost } from "../../../app/api/v1/billings/[id]/invoices/[invoiceId]/regenerate/route";

const m = billingService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const minimalBillingRow = {
  id: "BILL1",
  patient_id: "PAT1",
  status: "Active" as const
};

const minimalReceiptRow = {
  id: "RCT1",
  billing_id: "BILL1",
  amount: 100
};

const invoiceSummaryRow = {
  invoice: {
    id: "INV1",
    billing_id: "BILL1",
    invoice_no: "1",
    kind: "MONTHLY" as const,
    status: "UNPAID"
  },
  amount: 1000,
  received: 0,
  outstanding: 1000,
  status: "UNPAID" as const
};

const generateInvoiceResult = {
  invoice: {
    id: "INV1",
    billing_id: "BILL1",
    invoice_no: "1",
    status: "UNPAID"
  },
  lines: [],
  duplicate: false
};

const invoiceDetailResult = {
  invoice: { id: "INV1", billing_id: "BILL1" },
  lines: [],
  receipts: [],
  received: 0,
  outstanding: 0,
  status: "UNPAID" as const
};

describe("GET /api/v1/billings", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse (not in BILLING_READ_ROLES)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/billings");
    const res = await BillingsGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.list).not.toHaveBeenCalled();
  });

  // M2-H1: previously asserted Viewer (a non-existent role) could read
  // billings. After H1 removed the dead "Viewer" string, this test now
  // exercises the most read-only legitimate role — Accountant — which
  // is the actual production read-only persona in BILLING_READ_ROLES.
  it("permits Accountant (read-only billing role)", async () => {
    setActor(ACTORS.accountant);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest("GET", "/api/v1/billings?limit=5&q=anita");
    const res = await BillingsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.list).toHaveBeenCalledTimes(1);
    const [query] = m.list.mock.calls[0];
    expect(query.q).toBe("anita");
    expect(query.limit).toBe("5");
  });

  it("denies an unknown role (M2-H1 regression test)", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("GET", "/api/v1/billings");
    const res = await BillingsGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.list).not.toHaveBeenCalled();
  });

  it("uses listByPatient when only patient_id is present (legacy ledger bundle)", async () => {
    setActor(ACTORS.accountant);
    m.listByPatient.mockResolvedValue({
      success: true,
      data: {
        billings: [],
        receipts: [],
        services: [],
        invoices: [],
        totalsByBilling: {}
      }
    });
    const req = makeRequest("GET", "/api/v1/billings?patient_id=PAT1");
    const res = await BillingsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.listByPatient).toHaveBeenCalledWith("PAT1", expect.any(Object));
    expect(m.list).not.toHaveBeenCalled();
  });

  it("uses paginated list when patient_id is combined with list filters", async () => {
    setActor(ACTORS.accountant);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest("GET", "/api/v1/billings?patient_id=PAT1&status=Active&limit=5");
    const res = await BillingsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.list).toHaveBeenCalledWith(
      expect.objectContaining({ patient_id: "PAT1", status: "Active", limit: "5" }),
      expect.any(Object)
    );
    expect(m.listByPatient).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/billings", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff role (write requires Admin/Manager/Accountant)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/billings", { body: { patient_id: "PAT1" } });
    const res = await BillingsPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("allows Accountant and returns 201", async () => {
    setActor(ACTORS.accountant);
    m.create.mockResolvedValue({ success: true, data: minimalBillingRow });
    const req = makeRequest("POST", "/api/v1/billings", {
      body: { patient_id: "PAT1", period: "2026-05" }
    });
    const res = await BillingsPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("BILL1");
  });
});

describe("POST /api/v1/billings/[id]/close", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (close requires Accountant tier)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/billings/BILL1/close", { body: {} });
    const res = await BillingClosePost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.close).not.toHaveBeenCalled();
  });

  it("forwards reason/force flags for Manager", async () => {
    setActor(ACTORS.manager);
    m.close.mockResolvedValue({ success: true, data: billingSummaryFixture() });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/close", {
      body: { reason: "end of month", force: false }
    });
    const res = await BillingClosePost(req, ctx({ id: "BILL1" }));
    await expectOkEnvelope(res);
    expect(m.close).toHaveBeenCalledWith(
      "BILL1",
      { reason: "end of month", force: false },
      expect.any(Object)
    );
  });

  it("bubbles 'has outstanding' rule violation as 422", async () => {
    setActor(ACTORS.manager);
    m.close.mockResolvedValue({
      success: false,
      code: "business_rule_violation",
      error: "Cannot close: outstanding balance > 0"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/close", { body: {} });
    const res = await BillingClosePost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });
});

describe("Billing receipts endpoints", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  // M2-H1: was "for Viewer" (a role that never existed). Accountant is
  // the canonical read-only billing persona.
  it("GET returns receipts envelope for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.listReceiptsForBilling.mockResolvedValue({
      success: true,
      data: [minimalReceiptRow]
    });
    const req = makeRequest("GET", "/api/v1/billings/BILL1/receipts");
    const res = await BillingReceiptsGet(req, ctx({ id: "BILL1" }));
    const data = await expectOkEnvelope<Array<{ id: string }>>(res);
    expect(data).toHaveLength(1);
  });

  it("POST records a payment and merges billing_id from params", async () => {
    setActor(ACTORS.accountant);
    m.recordPayment.mockResolvedValue({ success: true, data: { ...minimalReceiptRow, amount: 500 } });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/receipts", {
      body: { amount: 500, invoice_id: "INV1", mode: "Cash" }
    });
    const res = await BillingReceiptsPost(req, ctx({ id: "BILL1" }));
    await expectCreatedEnvelope(res);
    expect(m.recordPayment).toHaveBeenCalledWith(
      { amount: 500, invoice_id: "INV1", mode: "Cash", billing_id: "BILL1" },
      expect.any(Object)
    );
  });

  it("POST rejects when amount exceeds outstanding (business rule)", async () => {
    setActor(ACTORS.accountant);
    m.recordPayment.mockResolvedValue({
      success: false,
      code: "business_rule_violation",
      error: "Receipt amount exceeds invoice outstanding"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/receipts", {
      body: { amount: 5000, invoice_id: "INV1" }
    });
    const res = await BillingReceiptsPost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });
});

describe("Invoice endpoints", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  // M2-H1: was "for any reader" using Viewer fixture. Switched to Staff
  // — the lowest-tier role in BILLING_READ_ROLES — to assert the same
  // intent (read-only access works for the broad reader cohort).
  it("GET list returns invoice envelope for Staff", async () => {
    setActor(ACTORS.staff);
    m.listInvoices.mockResolvedValue({
      success: true,
      data: [invoiceSummaryRow]
    });
    const req = makeRequest("GET", "/api/v1/billings/BILL1/invoices");
    const res = await InvoicesGet(req, ctx({ id: "BILL1" }));
    const data = await expectOkEnvelope<Array<{ invoice: { invoice_no: string } }>>(res);
    expect(data[0].invoice.invoice_no).toBe("1");
  });

  it("POST generates a monthly invoice and returns 201", async () => {
    setActor(ACTORS.accountant);
    m.generateInvoice.mockResolvedValue({
      success: true,
      data: generateInvoiceResult
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/invoices", {
      body: { kind: "MONTHLY", period: "2026-05" }
    });
    const res = await InvoicesPost(req, ctx({ id: "BILL1" }));
    const data = await expectCreatedEnvelope<{ invoice: { invoice_no: string } }>(res);
    expect(data.invoice.invoice_no).toBe("1");
    expect(m.generateInvoice).toHaveBeenCalledWith(
      { kind: "MONTHLY", period: "2026-05", billing_id: "BILL1" },
      expect.any(Object)
    );
  });

  it("POST returns 409 when a monthly invoice for that period already exists", async () => {
    setActor(ACTORS.manager);
    m.generateInvoice.mockResolvedValue({
      success: false,
      code: "duplicate",
      error: "Monthly invoice already exists for 2026-05"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/invoices", {
      body: { kind: "MONTHLY", period: "2026-05" }
    });
    const res = await InvoicesPost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 409, "duplicate");
  });

  it("DELETE hard-deletes invoice and detaches receipts", async () => {
    setActor(ACTORS.admin);
    m.cancelInvoice.mockResolvedValue({
      success: true,
      data: { deleted: true as const, invoice_no: "1", receipts_detached: 2 }
    });
    const req = makeRequest("DELETE", "/api/v1/billings/BILL1/invoices/INV1");
    const res = await InvoiceDelete(req, ctx({ id: "BILL1", invoiceId: "INV1" }));
    const data = await expectOkEnvelope<{ receipts_detached: number }>(res);
    expect(data.receipts_detached).toBe(2);
    expect(m.cancelInvoice).toHaveBeenCalledWith("INV1", expect.any(Object));
  });

  it("DELETE denied for Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("DELETE", "/api/v1/billings/BILL1/invoices/INV1");
    const res = await InvoiceDelete(req, ctx({ id: "BILL1", invoiceId: "INV1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.cancelInvoice).not.toHaveBeenCalled();
  });

  // M2-H1: was using the Viewer fixture; switched to Staff so the test
  // exercises a real role in BILLING_READ_ROLES.
  it("GET single invoice returns envelope", async () => {
    setActor(ACTORS.staff);
    m.getInvoice.mockResolvedValue({
      success: true,
      data: invoiceDetailResult
    });
    const req = makeRequest("GET", "/api/v1/billings/BILL1/invoices/INV1");
    const res = await InvoiceGet(req, ctx({ id: "BILL1", invoiceId: "INV1" }));
    const data = await expectOkEnvelope<{ lines: unknown[] }>(res);
    expect(Array.isArray(data.lines)).toBe(true);
  });

  it("POST regenerate succeeds for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.regenerateInvoice.mockResolvedValue({
      success: true,
      data: {
        invoice: { id: "INV1", billing_id: "BILL1" },
        lines: []
      }
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/invoices/INV1/regenerate");
    const res = await InvoiceRegeneratePost(req, ctx({ id: "BILL1", invoiceId: "INV1" }));
    const data = await expectOkEnvelope<{ invoice: { id: string } }>(res);
    expect(data.invoice.id).toBe("INV1");
  });

  it("POST regenerate refuses when receipts already applied (conflict)", async () => {
    setActor(ACTORS.admin);
    m.regenerateInvoice.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Cannot regenerate: receipts already applied"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/invoices/INV1/regenerate");
    const res = await InvoiceRegeneratePost(req, ctx({ id: "BILL1", invoiceId: "INV1" }));
    await expectErrorEnvelope(res, 409, "conflict");
  });
});
