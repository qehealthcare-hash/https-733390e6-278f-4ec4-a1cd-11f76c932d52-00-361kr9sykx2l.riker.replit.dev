/**
 * Service-level tests for the four Phase-12 report summary methods:
 *   - reportService.inquiriesSummary
 *   - reportService.patientsSummary
 *   - reportService.attendanceSummary
 *   - reportService.billingsSummary
 *
 * Repositories are mocked so the maths is exercised end-to-end without a
 * Supabase round-trip. Focus areas:
 *   - SQL count='exact' totals are trusted regardless of the row slice size
 *   - Period / from-to boundary resolution
 *   - Status / employee filter narrowing on attendance
 *   - Billing summary: total_received + outstanding aliases match
 *     buildBillingTotals math
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/database/reportRepository", () => {
  return {
    REPORT_ROW_CEILING: 1000,
    reportRepository: {
      countInquiriesScoped: vi.fn(),
      countInquiriesFollowupDue: vi.fn(),
      listInquiriesScoped: vi.fn(),
      listInquiriesForGroupBy: vi.fn(),
      countPatientsScoped: vi.fn(),
      listPatientsScoped: vi.fn(),
      listPatientsForGroupBy: vi.fn(),
      countAttendanceScoped: vi.fn(),
      listAttendanceInRange: vi.fn(),
      listAttendanceScoped: vi.fn(),
      listServicesInRange: vi.fn(),
      listReceiptsInRange: vi.fn()
    }
  };
});

vi.mock("@/database/billingRepository", () => ({
  billingRepository: {
    listBillingsByIds: vi.fn(),
    listSvcByBillingIds: vi.fn(),
    listActiveReceiptsByBillingIds: vi.fn()
  }
}));

vi.mock("@/database/patientRepository", () => ({
  patientRepository: {
    findByIds: vi.fn()
  }
}));

import { reportService } from "@/services/reportService";
import { reportRepository } from "@/database/reportRepository";
import { billingRepository } from "@/database/billingRepository";
import { patientRepository } from "@/database/patientRepository";

type Mock = ReturnType<typeof vi.fn>;
const repo = reportRepository as unknown as Record<string, Mock>;
const billings = billingRepository as unknown as Record<string, Mock>;
const patients = patientRepository as unknown as Record<string, Mock>;

const actorCtx = { actor: { email: "tester@hominal.test", role: "Admin" } };

function ok<T>(data: T) {
  return { success: true as const, data };
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) drains the `mockResolvedValueOnce`
  // queue between tests so a `once` queued in test A can't leak into
  // test B's first call.
  vi.resetAllMocks();
});

describe("reportService.inquiriesSummary", () => {
  it("uses SQL count='exact' totals and rolls free-form sources from group rows", async () => {
    // The service builds `statusCountTasks` via `INQUIRY_STATUS_BUCKETS.map`
    // (which fires those calls first), then queues the headline-total call.
    // So the consumption order is: 7 bucket counts THEN the overall total.
    repo.countInquiriesScoped
      .mockResolvedValueOnce(ok(50)) // New
      .mockResolvedValueOnce(ok(80)) // Contacted
      .mockResolvedValueOnce(ok(40)) // FollowUp
      .mockResolvedValueOnce(ok(60)) // Negotiating
      .mockResolvedValueOnce(ok(70)) // Converted
      .mockResolvedValueOnce(ok(30)) // Closed
      .mockResolvedValueOnce(ok(17)) // Lost
      .mockResolvedValueOnce(ok(347)); // overall total
    repo.countInquiriesFollowupDue.mockResolvedValueOnce(ok(12));
    repo.listInquiriesForGroupBy.mockResolvedValueOnce(
      ok([
        { id: "I1", status: "New", potential: "HOT", source: "Facebook" },
        { id: "I2", status: "Converted", potential: "WARM", source: "Walk-in" },
        { id: "I3", status: "Lost", potential: "COLD", source: "Walk-in" }
      ])
    );
    repo.listInquiriesScoped.mockResolvedValueOnce(
      ok([{ id: "I1", name: "Alice", status: "New", potential: "HOT" }])
    );

    const result = await reportService.inquiriesSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.summary.total).toBe(347);
    expect(result.data.summary.followup_due).toBe(12);
    // Enum bucket counts come from SQL — never from the 3-row group slice.
    expect(result.data.summary.by_status.New).toBe(50);
    expect(result.data.summary.by_status.Lost).toBe(17);
    // Free-form source bucketing from the group slice.
    expect(result.data.summary.by_source.Facebook).toBe(1);
    expect(result.data.summary.by_source["Walk-in"]).toBe(2);
    // Pagination metadata reflects the slice + SQL-derived total.
    expect(result.data.rows_total).toBe(347);
    expect(result.data.rows).toHaveLength(1);
  });

  it("collapses non-requested status buckets when ?status= is pinned", async () => {
    repo.countInquiriesScoped
      .mockResolvedValueOnce(ok(40)) // overall total for status=New
      .mockResolvedValueOnce(ok(40)) // bucket request — also clamped to status=New
      .mockResolvedValueOnce(ok(40))
      .mockResolvedValueOnce(ok(40))
      .mockResolvedValueOnce(ok(40))
      .mockResolvedValueOnce(ok(40))
      .mockResolvedValueOnce(ok(40))
      .mockResolvedValueOnce(ok(40));
    repo.countInquiriesFollowupDue.mockResolvedValueOnce(ok(0));
    repo.listInquiriesForGroupBy.mockResolvedValueOnce(ok([]));
    repo.listInquiriesScoped.mockResolvedValueOnce(ok([]));

    const result = await reportService.inquiriesSummary(
      { period: "2026-05", status: "New" },
      actorCtx
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Only the pinned bucket should reflect the SQL count; the others stay 0.
    expect(result.data.summary.by_status.New).toBe(40);
    expect(result.data.summary.by_status.Contacted).toBe(0);
    expect(result.data.summary.by_status.Lost).toBe(0);
  });

  it("returns an empty summary when the period has zero rows", async () => {
    repo.countInquiriesScoped.mockResolvedValue(ok(0));
    repo.countInquiriesFollowupDue.mockResolvedValueOnce(ok(0));
    repo.listInquiriesForGroupBy.mockResolvedValueOnce(ok([]));
    repo.listInquiriesScoped.mockResolvedValueOnce(ok([]));

    const result = await reportService.inquiriesSummary({ period: "2030-01" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary.total).toBe(0);
    expect(result.data.summary.by_status.New).toBe(0);
    expect(result.data.summary.grouping_truncated).toBe(false);
    expect(result.data.rows).toEqual([]);
    expect(result.data.rows_total).toBe(0);
  });

  it("propagates a repository failure as a passFailure envelope", async () => {
    repo.countInquiriesScoped.mockResolvedValue({
      success: false,
      error: "boom",
      code: "database_error"
    });
    repo.countInquiriesFollowupDue.mockResolvedValueOnce(ok(0));
    repo.listInquiriesForGroupBy.mockResolvedValueOnce(ok([]));
    repo.listInquiriesScoped.mockResolvedValueOnce(ok([]));

    const result = await reportService.inquiriesSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("database_error");
  });
});

describe("reportService.patientsSummary", () => {
  it("computes Active / Inactive from SQL counts and resolves the UTC month window", async () => {
    repo.countPatientsScoped
      .mockResolvedValueOnce(ok(120)) // total
      .mockResolvedValueOnce(ok(90)) // active
      .mockResolvedValueOnce(ok(30)); // inactive
    repo.listPatientsForGroupBy.mockResolvedValueOnce(
      ok([
        { id: "P1", status: "Active", area: "Andheri" },
        { id: "P2", status: "Active", area: "Andheri" },
        { id: "P3", status: "Inactive", area: "Bandra" }
      ])
    );
    repo.listPatientsScoped.mockResolvedValueOnce(ok([{ id: "P1", name: "Anita" }]));

    const result = await reportService.patientsSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary.total).toBe(120);
    expect(result.data.summary.by_status.Active).toBe(90);
    expect(result.data.summary.by_status.Inactive).toBe(30);
    expect(result.data.summary.by_area.Andheri).toBe(2);
    expect(result.data.summary.by_area.Bandra).toBe(1);

    // Period resolved into a UTC month window — verify by inspecting the
    // first repo call's ISO timestamps.
    const [startISO] = repo.countPatientsScoped.mock.calls[0];
    expect(startISO).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("reportService.attendanceSummary", () => {
  it("applies employee_id filter to every repo call and respects status narrowing", async () => {
    repo.countAttendanceScoped.mockResolvedValueOnce(ok(15));
    // listAttendanceInRange is the unfiltered rollup source — the service
    // applies query.status itself.
    repo.listAttendanceInRange.mockResolvedValueOnce(
      ok([
        { id: "A1", employee_id: "EMP1", status: "PRESENT", hours: 8 },
        { id: "A2", employee_id: "EMP1", status: "ABSENT", hours: 0 },
        { id: "A3", employee_id: "EMP2", status: "PRESENT", hours: 8 }
      ])
    );
    repo.listAttendanceScoped.mockResolvedValueOnce(
      ok([{ id: "A1", employee_id: "EMP1", status: "PRESENT" }])
    );

    const result = await reportService.attendanceSummary(
      { period: "2026-05", employee_id: "EMP1", status: "PRESENT" },
      actorCtx
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Status filter applied to the rollup — ABSENT row excluded.
    expect(result.data.summary.by_status.PRESENT).toBe(2);
    expect(result.data.summary.by_status.ABSENT).toBe(0);
    // total comes from SQL count, not the filtered rollup.
    expect(result.data.summary.total).toBe(15);
    // employee_id must be forwarded to every repo call.
    expect(repo.countAttendanceScoped.mock.calls[0][2]).toEqual({
      employee_id: "EMP1",
      status: "PRESENT"
    });
    expect(repo.listAttendanceInRange.mock.calls[0][2]).toEqual({
      employee_id: "EMP1"
    });
  });

  it("rolls present/absent/late/leave/holiday counts per employee", async () => {
    repo.countAttendanceScoped.mockResolvedValueOnce(ok(6));
    repo.listAttendanceInRange.mockResolvedValueOnce(
      ok([
        { employee_id: "EMP1", status: "PRESENT", hours: 8 },
        { employee_id: "EMP1", status: "PRESENT", hours: 8 },
        { employee_id: "EMP1", status: "LATE", hours: 7 },
        { employee_id: "EMP2", status: "ABSENT", hours: 0 },
        { employee_id: "EMP2", status: "LEAVE", hours: 0 },
        { employee_id: "EMP2", status: "HOLIDAY", hours: 0 }
      ])
    );
    repo.listAttendanceScoped.mockResolvedValueOnce(ok([]));

    const result = await reportService.attendanceSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const emp1 = result.data.summary.by_employee.find((e) => e.employee_id === "EMP1");
    const emp2 = result.data.summary.by_employee.find((e) => e.employee_id === "EMP2");
    expect(emp1).toMatchObject({ present: 2, late: 1, hours: 23 });
    expect(emp2).toMatchObject({ absent: 1, leave: 1, holiday: 1 });
  });
});

describe("reportService.billingsSummary", () => {
  it("aggregates services + receipts and exposes total_received / outstanding aliases", async () => {
    repo.listServicesInRange.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", total: 1000, date: "2026-05-10" },
        { billing_id: "B2", total: 500, date: "2026-05-12" }
      ])
    );
    repo.listReceiptsInRange.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", amount: 600, date: "2026-05-15" },
        { billing_id: "B2", amount: 500, date: "2026-05-20" }
      ])
    );
    billings.listBillingsByIds.mockResolvedValueOnce(
      ok([
        { id: "B1", status: "Active", patient_id: "P1", sec_dep: 0, created_at: "2026-05-01" },
        { id: "B2", status: "Closed", patient_id: "P2", sec_dep: 0, created_at: "2026-05-03" }
      ])
    );
    patients.findByIds.mockResolvedValueOnce(
      ok([
        { id: "P1", name: "Anita Kumar", phone: "9999988888" },
        { id: "P2", name: "Rohan Mehta", phone: "9777766666" }
      ])
    );
    // Per-row totals come from the bill's full lifetime ledger, not the window.
    billings.listSvcByBillingIds.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", total: 1000 },
        { billing_id: "B2", total: 500 }
      ])
    );
    billings.listActiveReceiptsByBillingIds.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", amount: 600 },
        { billing_id: "B2", amount: 500 }
      ])
    );

    const result = await reportService.billingsSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary.service_total).toBe(1500);
    expect(result.data.summary.collected).toBe(1100);
    expect(result.data.summary.pending).toBe(400);
    // Aliases expected by the page CSV / table.
    expect(result.data.summary.total_received).toBe(1100);
    expect(result.data.summary.outstanding).toBe(400);
    expect(result.data.summary.billings_count).toBe(2);
    // Rows enriched with patient + per-billing totals.
    expect(result.data.rows).toHaveLength(2);
    const b1 = result.data.rows.find((r) => r.id === "B1");
    expect(b1?.patient_name).toBe("Anita Kumar");
    expect((b1?.totals as { outstanding: number }).outstanding).toBe(400);
  });

  it("marks a bill PAID when its receipt was recorded outside the report window", async () => {
    // Services fall in the window; the matching receipt was recorded in a
    // later month, so it is NOT in the windowed receipt rows. The per-row
    // totals must still use the bill's full ledger and report outstanding 0.
    repo.listServicesInRange.mockResolvedValueOnce(
      ok([{ billing_id: "B1", total: 1000, date: "2026-05-10" }])
    );
    repo.listReceiptsInRange.mockResolvedValueOnce(ok([]));
    billings.listBillingsByIds.mockResolvedValueOnce(
      ok([{ id: "B1", status: "Active", patient_id: "P1", sec_dep: 0 }])
    );
    billings.listSvcByBillingIds.mockResolvedValueOnce(
      ok([{ billing_id: "B1", total: 1000 }])
    );
    // Full lifetime ledger: the bill was fully paid (receipt in June).
    billings.listActiveReceiptsByBillingIds.mockResolvedValueOnce(
      ok([{ billing_id: "B1", amount: 1000, date: "2026-06-02" }])
    );
    patients.findByIds.mockResolvedValueOnce(ok([]));

    const result = await reportService.billingsSummary({ period: "2026-05" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const b1 = result.data.rows.find((r) => r.id === "B1");
    expect((b1?.totals as { outstanding: number }).outstanding).toBe(0);
    expect((b1 as { paid_status?: string })?.paid_status).toBe("PAID");
  });

  it("returns an empty summary when no svc/receipt rows touch the window", async () => {
    repo.listServicesInRange.mockResolvedValueOnce(ok([]));
    repo.listReceiptsInRange.mockResolvedValueOnce(ok([]));
    // No active ids => repository should not be hit for billings.
    billings.listBillingsByIds.mockResolvedValueOnce(ok([]));
    billings.listSvcByBillingIds.mockResolvedValueOnce(ok([]));
    billings.listActiveReceiptsByBillingIds.mockResolvedValueOnce(ok([]));
    patients.findByIds.mockResolvedValueOnce(ok([]));

    const result = await reportService.billingsSummary({ period: "2030-12" }, actorCtx);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary.service_total).toBe(0);
    expect(result.data.summary.collected).toBe(0);
    expect(result.data.summary.billings_count).toBe(0);
    expect(result.data.rows).toEqual([]);
  });

  it("filters the row slice by status without breaking aggregate totals", async () => {
    repo.listServicesInRange.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", total: 1000 },
        { billing_id: "B2", total: 500 }
      ])
    );
    repo.listReceiptsInRange.mockResolvedValueOnce(
      ok([{ billing_id: "B1", amount: 1000 }])
    );
    billings.listBillingsByIds.mockResolvedValueOnce(
      ok([
        { id: "B1", status: "Closed", patient_id: "P1", sec_dep: 0 },
        { id: "B2", status: "Active", patient_id: "P2", sec_dep: 0 }
      ])
    );
    billings.listSvcByBillingIds.mockResolvedValueOnce(
      ok([
        { billing_id: "B1", total: 1000 },
        { billing_id: "B2", total: 500 }
      ])
    );
    billings.listActiveReceiptsByBillingIds.mockResolvedValueOnce(
      ok([{ billing_id: "B1", amount: 1000 }])
    );
    patients.findByIds.mockResolvedValueOnce(ok([]));

    const result = await reportService.billingsSummary(
      { period: "2026-05", status: "Closed" },
      actorCtx
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Headline aggregates still cover BOTH billings.
    expect(result.data.summary.service_total).toBe(1500);
    expect(result.data.summary.billings_count).toBe(2);
    // But the row slice is narrowed to Closed.
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].id).toBe("B1");
    expect(result.data.rows_total).toBe(1);
  });
});
