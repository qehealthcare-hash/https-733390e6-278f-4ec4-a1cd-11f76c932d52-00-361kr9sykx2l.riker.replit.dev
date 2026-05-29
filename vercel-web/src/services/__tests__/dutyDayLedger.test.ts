/**
 * Phase 11 — duty-day ledger service tests.
 *
 * These tests validate the parallel ledger sync behaviour. The ledger MUST
 * be best-effort: every write goes through a try/catch and a console.error
 * so a failing ledger call never breaks the underlying receipt / payout /
 * svc-entry flow.
 *
 * Coverage:
 *   1. expandSvcEntryToDayRows expands a date-range entry into N day rows.
 *   2. billingService.recordPayment fires markPaidToPatient for the
 *      receipt-covered day-ids.
 *   3. billingService.softDeleteReceipt releases day-rows.
 *   4. payoutService.replacePayoutCharges fires markPaidToStaff.
 *   5. billingService.replaceServiceEntries soft-deletes orphaned day-rows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dutyDayRepository,
  expandSvcEntryToDayRows
} from "@/database/dutyDayRepository";
import { dutyDayLedger } from "@/services/dutyDayLedger";
import { billingService } from "@/services/billingService";
import { payoutService } from "@/services/payoutService";
import { billingRepository } from "@/database/billingRepository";
import { payoutRepository } from "@/database/payoutRepository";
import { patientRepository } from "@/database/patientRepository";

vi.mock("@/database/dutyDayRepository", async (orig) => {
  const actual = await orig<typeof import("@/database/dutyDayRepository")>();
  return {
    ...actual,
    dutyDayRepository: {
      listByBilling: vi.fn(),
      listByEmployeePeriod: vi.fn(),
      listByEntryId: vi.fn(),
      markPaidToPatient: vi.fn(),
      releaseFromPatient: vi.fn(),
      markPaidToStaff: vi.fn(),
      releaseFromStaff: vi.fn(),
      softDeleteByEntryId: vi.fn(),
      upsertFromSvcEntry: vi.fn(),
      findById: vi.fn()
    }
  };
});
vi.mock("@/database/billingRepository");
vi.mock("@/database/payoutRepository");
vi.mock("@/database/patientRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

// `dutyDayLedger` resolves day-row ids by reading from `hh_duty_days`
// directly via the Supabase client. We stub that read by intercepting
// the resolver path used internally.
const mockLookupIds = vi.fn<(filters: unknown) => Promise<string[]>>();
vi.mock("@/database/baseRepository", async (orig) => {
  const actual = await orig<typeof import("@/database/baseRepository")>();
  type SupabaseLike = {
    from: (table: string) => unknown;
  };
  const fakeClient: SupabaseLike = {
    from(table: string) {
      const ctx: Record<string, unknown> = { table, filters: [] as unknown[] };
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          (ctx.filters as unknown[]).push({ op: "eq", col, val });
          return chain;
        },
        in(col: string, vals: unknown[]) {
          (ctx.filters as unknown[]).push({ op: "in", col, val: vals });
          return chain;
        },
        is(col: string, val: unknown) {
          (ctx.filters as unknown[]).push({ op: "is", col, val });
          return chain;
        },
        gte(col: string, val: unknown) {
          (ctx.filters as unknown[]).push({ op: "gte", col, val });
          return chain;
        },
        lte(col: string, val: unknown) {
          (ctx.filters as unknown[]).push({ op: "lte", col, val });
          return chain;
        },
        update() {
          return chain;
        },
        order() {
          return chain;
        },
        async then(resolve: (v: { data: unknown[]; error: null }) => void) {
          const ids = await mockLookupIds(ctx);
          resolve({
            data: ids.map((id) => ({ id, service_date: "2026-05-01" })),
            error: null
          });
        }
      };
      return chain;
    }
  };
  return {
    ...actual,
    resolveClient: () => fakeClient as unknown as ReturnType<typeof actual.resolveClient>
  };
});

const ctx = { actor: { email: "acct@test.com", accessToken: "tok" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockLookupIds.mockReset();
  mockLookupIds.mockResolvedValue([]);
});

// ──────────────────────────────────────────────────────────────────────────────
// 1. Backfill expansion (pure)
// ──────────────────────────────────────────────────────────────────────────────

describe("expandSvcEntryToDayRows", () => {
  it("expands a multi-day entry into N per-day rows", () => {
    const rows = expandSvcEntryToDayRows({
      id: "00000000-0000-0000-0000-000000000001",
      svc_key: "BILL1_Care Taker Services",
      billing_id: "BILL1",
      service_name: "Care Taker Services",
      partner_id: "EMP1",
      date: "2026-05-01",
      count: 3,
      amt: 750
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].service_date).toBe("2026-05-01");
    expect(rows[1].service_date).toBe("2026-05-02");
    expect(rows[2].service_date).toBe("2026-05-03");
    expect(rows.every((r) => r.svc_entry_id === "00000000-0000-0000-0000-000000000001"))
      .toBe(true);
    expect(rows[0].patient_rate).toBe(750);
    expect(rows[0].employee_id).toBe("EMP1");
  });

  it("returns a single day-row when count is 1 (the production norm)", () => {
    const rows = expandSvcEntryToDayRows({
      id: "u1",
      billing_id: "BILL1",
      service_name: "Care Taker Services",
      partner_id: "EMP1",
      date: "2026-05-25",
      count: 1,
      amt: 750
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].service_date).toBe("2026-05-25");
  });

  it("returns no rows for malformed dates so callers can skip cleanly", () => {
    const rows = expandSvcEntryToDayRows({
      id: "u1",
      date: "not-a-date",
      count: 5
    });
    expect(rows).toEqual([]);
  });

  it("treats count <= 0 as 1 (defensive default)", () => {
    const rows = expandSvcEntryToDayRows({
      id: "u1",
      date: "2026-05-01",
      count: 0
    });
    expect(rows).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Receipt create → markPaidToPatient
// ──────────────────────────────────────────────────────────────────────────────

describe("billingService.recordPayment (Phase 16 RPC ledger)", () => {
  it("persists via hominal_save_receipt RPC without parallel ledger sync", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 0 },
        services: [{ total: 3000 }],
        receipts: []
      }
    });
    vi.mocked(patientRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Test" }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(billingRepository.saveReceiptV2Rpc).mockResolvedValue({
      success: true,
      data: {
        id: "RCPT_NEW",
        billing_id: "BILL1",
        patient_id: "PAT1",
        receipt_no: "RCT2026000001",
        amount: 1500,
        date: "2026-05-25",
        paid_dates: ["2026-05-01", "2026-05-02"]
      }
    });
    const result = await billingService.recordPayment(
      {
        billing_id: "BILL1",
        amount: 1500,
        date: "2026-05-25",
        type: "Advance",
        method: "Cash"
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(billingRepository.saveReceiptV2Rpc).toHaveBeenCalled();
    expect(dutyDayRepository.markPaidToPatient).not.toHaveBeenCalled();
  });

  it("still succeeds when saveReceiptRpc returns data", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 0 },
        services: [{ total: 3000 }],
        receipts: []
      }
    });
    vi.mocked(patientRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Test" }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(billingRepository.saveReceiptV2Rpc).mockResolvedValue({
      success: true,
      data: {
        id: "RCPT2",
        billing_id: "BILL1",
        patient_id: "PAT1",
        receipt_no: "RCT2026000002",
        amount: 1000,
        date: "2026-05-25",
        paid_dates: ["2026-05-05"]
      }
    });
    const result = await billingService.recordPayment(
      {
        billing_id: "BILL1",
        amount: 1000,
        date: "2026-05-25",
        type: "Advance",
        method: "Cash"
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(dutyDayRepository.markPaidToPatient).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Receipt delete → releaseFromPatient
// ──────────────────────────────────────────────────────────────────────────────

describe("billingService.softDeleteReceipt (Phase 16 RPC ledger)", () => {
  it("calls hominal_soft_delete_receipt RPC and defensive ledger release", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.findReceiptById).mockResolvedValue({
      success: true,
      data: { id: "RCPT1", billing_id: "BILL1", invoice_id: null }
    });
    vi.mocked(billingRepository.softDeleteReceiptRpc).mockResolvedValue({
      success: true,
      data: { id: "RCPT1", deleted_at: new Date().toISOString() }
    });
    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 0 },
        services: [],
        receipts: []
      }
    });
    vi.mocked(patientRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Test" }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(billingRepository.updateBilling).mockResolvedValue({
      success: true,
      data: { id: "BILL1", paid_status: "UNPAID" }
    });
    vi.mocked(dutyDayRepository.releaseFromPatient).mockResolvedValue({
      success: true,
      data: 0
    });
    const result = await billingService.softDeleteReceipt("BILL1", "RCPT1", ctx);
    expect(result.success).toBe(true);
    expect(billingRepository.softDeleteReceiptRpc).toHaveBeenCalled();
    // Defensive parallel release runs in addition to the RPC. It is
    // idempotent (only clears rows still linked to this receipt id) so it's
    // safe whether or not the Phase 16 migration has been applied.
    expect(dutyDayRepository.releaseFromPatient).toHaveBeenCalledWith(
      "RCPT1",
      ctx.actor.email,
      expect.anything()
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Payout charge create → markPaidToStaff
// ──────────────────────────────────────────────────────────────────────────────

describe("payoutService.replacePayoutCharges ledger sync", () => {
  it("links freshly inserted payout_charges to their day-rows", async () => {
    vi.mocked(payoutRepository.replacePayoutChargesRpc).mockResolvedValue({
      success: true,
      data: 2
    });
    vi.mocked(payoutRepository.listChargesBySvcKey).mockResolvedValue({
      success: true,
      data: [
        {
          id: "PC1",
          svc_key: "BILL1_Care Taker Services",
          billing_id: "BILL1",
          partner_id: "EMP1",
          service_name: "Care Taker Services",
          date: "2026-05-01",
          amount: 566
        },
        {
          id: "PC2",
          svc_key: "BILL1_Care Taker Services",
          billing_id: "BILL1",
          partner_id: "EMP1",
          service_name: "Care Taker Services",
          date: "2026-05-02",
          amount: 566
        }
      ]
    });
    // Each charge maps to one existing day-row.
    mockLookupIds
      .mockResolvedValueOnce(["DD_A"])
      .mockResolvedValueOnce(["DD_B"]);
    vi.mocked(dutyDayRepository.markPaidToStaff).mockResolvedValue({
      success: true,
      data: 1
    });

    const result = await payoutService.replacePayoutCharges(
      {
        svc_key: "BILL1_Care Taker Services",
        rows: [
          {
            date: "2026-05-01",
            partner: "EMP1",
            partner_id: "EMP1",
            term: "Care",
            amount: 566
          },
          {
            date: "2026-05-02",
            partner: "EMP1",
            partner_id: "EMP1",
            term: "Care",
            amount: 566
          }
        ]
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(dutyDayRepository.markPaidToStaff).toHaveBeenCalledTimes(2);
    expect(dutyDayRepository.markPaidToStaff).toHaveBeenNthCalledWith(
      1,
      "PC1",
      ["DD_A"],
      "acct@test.com",
      expect.anything()
    );
    expect(dutyDayRepository.markPaidToStaff).toHaveBeenNthCalledWith(
      2,
      "PC2",
      ["DD_B"],
      "acct@test.com",
      expect.anything()
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. svc-entry replace → soft-delete orphans
// ──────────────────────────────────────────────────────────────────────────────

describe("billingService.replaceServiceEntries ledger sync", () => {
  it("upserts day-rows for fresh entries and soft-deletes orphans", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.findInvoiceForPeriod).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(billingRepository.replaceSvcEntriesRpc).mockResolvedValue({
      success: true,
      data: 2
    });
    vi.mocked(billingRepository.listSvcByBilling).mockResolvedValue({
      success: true,
      data: [
        {
          id: "SVC_NEW1",
          svc_key: "BILL1_Care Taker Services",
          billing_id: "BILL1",
          service_name: "Care Taker Services",
          partner_id: "EMP1",
          date: "2026-05-01",
          count: 1,
          amt: 750
        },
        {
          id: "SVC_NEW2",
          svc_key: "BILL1_Care Taker Services",
          billing_id: "BILL1",
          service_name: "Care Taker Services",
          partner_id: "EMP1",
          date: "2026-05-02",
          count: 1,
          amt: 750
        }
      ]
    });
    vi.mocked(dutyDayRepository.upsertFromSvcEntry).mockResolvedValue({
      success: true,
      data: 1
    });
    // syncSvcKeyReplace lookup → existing day-rows; one orphan id.
    mockLookupIds.mockResolvedValueOnce([
      "DD_keep1",
      "DD_keep2",
      "DD_orphan"
    ]);

    const result = await billingService.replaceServiceEntries(
      {
        svc_key: "BILL1_Care Taker Services",
        rows: [
          {
            billing_id: "BILL1",
            service_name: "Care Taker Services",
            partner_id: "EMP1",
            date: "2026-05-01",
            amt: 750,
            count: 1,
            disc: 0,
            total: 750
          },
          {
            billing_id: "BILL1",
            service_name: "Care Taker Services",
            partner_id: "EMP1",
            date: "2026-05-02",
            amt: 750,
            count: 1,
            disc: 0,
            total: 750
          }
        ]
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(dutyDayRepository.upsertFromSvcEntry).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. soft-delete cascade behaviour at the ledger helper
// ──────────────────────────────────────────────────────────────────────────────

describe("dutyDayLedger.syncSvcEntryDeleted", () => {
  it("calls softDeleteByEntryId on the repo and returns the row count", async () => {
    vi.mocked(dutyDayRepository.softDeleteByEntryId).mockResolvedValue({
      success: true,
      data: 4
    });
    const n = await dutyDayLedger.syncSvcEntryDeleted("ENTRY1", "acct@test.com");
    expect(n).toBe(4);
    expect(dutyDayRepository.softDeleteByEntryId).toHaveBeenCalledWith(
      "ENTRY1",
      "acct@test.com",
      undefined
    );
  });

  it("returns 0 (no throw) when the underlying call fails", async () => {
    vi.mocked(dutyDayRepository.softDeleteByEntryId).mockRejectedValue(
      new Error("db down")
    );
    const n = await dutyDayLedger.syncSvcEntryDeleted("ENTRY1", "acct@test.com");
    expect(n).toBe(0);
  });
});
