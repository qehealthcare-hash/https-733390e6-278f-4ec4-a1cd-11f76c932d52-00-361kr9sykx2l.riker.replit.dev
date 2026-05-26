/**
 * RBAC matrix integration test.
 *
 * For each (route, method, role) combination we assert the expected
 * outcome: ALLOW (no 403) vs DENY (403 forbidden). Anonymous callers
 * always return 401. This is a single locked-down view of who can do
 * what — easier to audit than reading every route handler individually.
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

// Every service that any tested route reaches needs to be mocked into a
// no-op so RBAC denials are the only thing the route surface emits.
vi.mock("@/services/patientService", () => ({
  patientService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));
vi.mock("@/services/employeeService", () => ({
  employeeService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    remove: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));
vi.mock("@/services/billingService", () => ({
  billingService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    close: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    listReceiptsForBilling: vi.fn().mockResolvedValue({ success: true, data: [] }),
    recordPayment: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    listInvoices: vi.fn().mockResolvedValue({ success: true, data: [] }),
    generateInvoice: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    cancelInvoice: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));
vi.mock("@/services/payoutService", () => ({
  payoutService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    ensure: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    markPaid: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));
vi.mock("@/services/attendanceService", () => ({
  attendanceService: {
    list: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    create: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } }),
    dayMark: vi.fn().mockResolvedValue({ success: true, data: { id: "X" } })
  }
}));

import {
  ACTORS,
  type HarnessActor,
  ctx,
  makeRequest,
  setActor
} from "@/test/routeHarness";

import { GET as PatientsGet, POST as PatientsPost } from "../../../app/api/v1/patients/route";
import { POST as EmployeesPost } from "../../../app/api/v1/employees/route";
import { DELETE as EmployeeDelete } from "../../../app/api/v1/employees/[id]/route";
import { GET as DutiesGet, POST as DutiesPost } from "../../../app/api/v1/duties/route";
import { GET as BillingsGet, POST as BillingsPost } from "../../../app/api/v1/billings/route";
import { POST as BillingClose } from "../../../app/api/v1/billings/[id]/close/route";
import { POST as InvoicesPost } from "../../../app/api/v1/billings/[id]/invoices/route";
import { POST as PayoutsPost } from "../../../app/api/v1/payouts/route";
import { POST as PayoutPay } from "../../../app/api/v1/payouts/pay/route";
import { POST as AttendanceDayMark } from "../../../app/api/v1/attendance/day/mark/route";

type RouteCall = () => Promise<Response>;

interface Case {
  route: string;
  call: () => RouteCall;
  allow: HarnessActor[];
  deny: HarnessActor[];
}

const CASES: Case[] = [
  {
    route: "GET /patients",
    call:
      () => async () =>
        PatientsGet(makeRequest("GET", "/api/v1/patients"), ctx({})),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.staff, ACTORS.accountant, ACTORS.nurse],
    deny: [ACTORS.viewer]
  },
  {
    route: "POST /patients",
    call:
      () => async () =>
        PatientsPost(
          makeRequest("POST", "/api/v1/patients", { body: { name: "X" } }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.staff],
    deny: [ACTORS.accountant, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /employees",
    call:
      () => async () =>
        EmployeesPost(
          makeRequest("POST", "/api/v1/employees", { body: {} }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.manager],
    deny: [ACTORS.staff, ACTORS.accountant, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "DELETE /employees/:id",
    call:
      () => async () =>
        EmployeeDelete(
          makeRequest("DELETE", "/api/v1/employees/EMP1"),
          ctx({ id: "EMP1" })
        ),
    allow: [ACTORS.admin],
    deny: [ACTORS.manager, ACTORS.staff, ACTORS.accountant, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "GET /duties",
    call:
      () => async () =>
        DutiesGet(makeRequest("GET", "/api/v1/duties"), ctx({})),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.staff, ACTORS.nurse],
    deny: [ACTORS.accountant, ACTORS.viewer]
  },
  {
    route: "POST /duties",
    call:
      () => async () =>
        DutiesPost(
          makeRequest("POST", "/api/v1/duties", { body: {} }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.staff],
    deny: [ACTORS.accountant, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "GET /billings",
    call:
      () => async () =>
        BillingsGet(makeRequest("GET", "/api/v1/billings"), ctx({})),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.accountant, ACTORS.staff, ACTORS.viewer],
    deny: [ACTORS.nurse]
  },
  {
    route: "POST /billings",
    call:
      () => async () =>
        BillingsPost(
          makeRequest("POST", "/api/v1/billings", { body: {} }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.accountant],
    deny: [ACTORS.staff, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /billings/:id/close",
    call:
      () => async () =>
        BillingClose(
          makeRequest("POST", "/api/v1/billings/BILL1/close", { body: {} }),
          ctx({ id: "BILL1" })
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.accountant],
    deny: [ACTORS.staff, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /billings/:id/invoices",
    call:
      () => async () =>
        InvoicesPost(
          makeRequest("POST", "/api/v1/billings/BILL1/invoices", {
            body: { kind: "MONTHLY", period: "2026-05" }
          }),
          ctx({ id: "BILL1" })
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.accountant],
    deny: [ACTORS.staff, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /payouts",
    call:
      () => async () =>
        PayoutsPost(
          makeRequest("POST", "/api/v1/payouts", { body: {} }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.accountant],
    deny: [ACTORS.staff, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /payouts/pay",
    call:
      () => async () =>
        PayoutPay(
          makeRequest("POST", "/api/v1/payouts/pay", { body: {} }),
          ctx({})
        ),
    allow: [ACTORS.admin, ACTORS.accountant],
    deny: [ACTORS.manager, ACTORS.staff, ACTORS.nurse, ACTORS.viewer]
  },
  {
    route: "POST /attendance/day/mark",
    call:
      () => async () =>
        AttendanceDayMark(
          makeRequest("POST", "/api/v1/attendance/day/mark", {
            body: { employee_id: "EMP1", date: "2026-05-25", status: "Present" }
          }),
          ctx({})
        ),
    // Routes accept Supervisor too but our ACTORS only ships Nurse — sufficient.
    allow: [ACTORS.admin, ACTORS.manager, ACTORS.staff, ACTORS.nurse],
    deny: [ACTORS.accountant, ACTORS.viewer]
  }
];

describe("RBAC matrix (no anonymous + role gates)", () => {
  beforeEach(() => {
    setActor(null);
  });

  for (const c of CASES) {
    it(`${c.route} returns 401 anonymous`, async () => {
      // Strip Authorization to simulate anonymous caller.
      const orig = c.call();
      const res = await orig().then(async (r) => r);
      // 401 expected because no actor / no token attached when actor unset.
      expect(res.status).toBe(401);
    });

    for (const actor of c.allow) {
      it(`${c.route} allows ${actor.role}`, async () => {
        setActor(actor);
        const res = await c.call()();
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
      });
    }

    for (const actor of c.deny) {
      it(`${c.route} denies ${actor.role} with 403`, async () => {
        setActor(actor);
        const res = await c.call()();
        expect(res.status).toBe(403);
      });
    }
  }
});
