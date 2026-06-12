/**
 * Integration test — employee lifecycle through validation + business gates.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { employeeService } from "@/services/employeeService";

type Row = Record<string, unknown>;

let employees: Row[] = [];
let audits: Row[] = [];
let duties: Row[] = [];

function nowIso() {
  return new Date().toISOString();
}

function fullName(row: Row) {
  return [row.fn, row.mn, row.ln].filter(Boolean).join(" ").trim();
}

vi.mock("@/database/employeeRepository", () => ({
  employeeRepository: {
    async findById(id: string) {
      const row = employees.find((e) => e.id === id) || null;
      return { success: true as const, data: row };
    },
    async list(filters: { q?: string; status?: string } = {}) {
      let rows = [...employees];
      if (filters.status) rows = rows.filter((e) => e.status === filters.status);
      if (filters.q) {
        const term = filters.q.toLowerCase();
        rows = rows.filter(
          (e) =>
            fullName(e).toLowerCase().includes(term) ||
            String(e.fn || "")
              .toLowerCase()
              .includes(term)
        );
      }
      return { success: true as const, data: { rows, total: rows.length } };
    },
    async insert(row: Row) {
      const next = { ...row, created_at: nowIso(), updated_at: nowIso() };
      employees.push(next);
      return { success: true as const, data: next };
    },
    async update(id: string, patch: Row) {
      const idx = employees.findIndex((e) => e.id === id);
      if (idx < 0) return { success: false as const, error: "not found", code: "not_found" };
      employees[idx] = { ...employees[idx], ...patch, updated_at: nowIso() };
      return { success: true as const, data: employees[idx] };
    },
    async updateStatus(id: string, patch: Row) {
      const idx = employees.findIndex((e) => e.id === id);
      if (idx < 0) return { success: false as const, error: "not found", code: "not_found" };
      employees[idx] = { ...employees[idx], ...patch, updated_at: nowIso() };
      return { success: true as const, data: employees[idx] };
    },
    async remove(id: string) {
      const before = employees.length;
      employees = employees.filter((e) => e.id !== id);
      return employees.length < before
        ? { success: true as const, data: null }
        : { success: false as const, error: "not found", code: "not_found" };
    },
    async findByPhoneSuffix(phone: string) {
      const suffix = phone.replace(/\D/g, "").slice(-8);
      const rows = employees.filter((e) => String(e.phone || "").includes(suffix));
      return { success: true as const, data: rows };
    },
    async findActiveByName(nameKey: string, excludeId?: string) {
      const key = nameKey.trim().toLowerCase().replace(/\s+/g, " ");
      const rows = employees.filter((e) => {
        if (e.status !== "Active") return false;
        if (excludeId && e.id === excludeId) return false;
        return fullName(e).toLowerCase().replace(/\s+/g, " ") === key;
      });
      return { success: true as const, data: rows };
    },
    async findActiveByAadhar(aadhar: string, excludeId?: string) {
      const digits = aadhar.replace(/\D/g, "");
      const rows = employees.filter((e) => {
        if (e.status !== "Active") return false;
        if (excludeId && e.id === excludeId) return false;
        return String(e.aadhar || "").replace(/\D/g, "") === digits;
      });
      return { success: true as const, data: rows };
    },
    async countDuties(employeeId: string) {
      return {
        success: true as const,
        data: duties.filter((d) => d.employee_id === employeeId).length
      };
    },
    async countAttendance() {
      return { success: true as const, data: 0 };
    },
    async countPayouts() {
      return { success: true as const, data: 0 };
    },
    async countCaretakerAssignments() {
      return { success: true as const, data: 0 };
    }
  }
}));

vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn(async (_db, actor, payload) => {
    audits.push({ ...payload, user_id: actor.email, created_at: nowIso() });
    return { success: true as const, data: null };
  }),
  finalizeWithAudit: vi.fn(async (auditResult, data) => {
    if (auditResult && auditResult.success === false) return auditResult;
    return { success: true as const, data };
  })
}));

const ACTOR = { email: "admin@test", role: "Admin", accessToken: "" };

beforeEach(() => {
  employees = [];
  audits = [];
  duties = [];
});

describe("employee lifecycle", () => {
  it("blocks profile edit when employee is OnLeave", async () => {
    const created = await employeeService.create(
      { fn: "Asha", ln: "Verma", phone: "9876543210", status: "Active" },
      { actor: ACTOR }
    );
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;
    employees[0].status = "OnLeave";

    const edited = await employeeService.update(
      id,
      { fn: "Asha", ln: "Verma", phone: "9876543210", area: "Naranpura" },
      { actor: ACTOR }
    );
    expect(edited.success).toBe(false);
    expect(edited.code).toBe("business_rule_violation");
  });

  it("allows status change via setStatus while OnLeave", async () => {
    const created = await employeeService.create(
      { fn: "Asha", ln: "Verma", phone: "9876543211", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    await employeeService.setStatus(id, { status: "OnLeave", reason: "leave" }, { actor: ACTOR });
    const back = await employeeService.setStatus(id, { status: "Active" }, { actor: ACTOR });
    expect(back.success).toBe(true);
    expect(employees.find((e) => e.id === id)?.status).toBe("Active");
  });

  it("blocks duplicate name and aadhar; respects confirm_duplicate_name", async () => {
    await employeeService.create(
      {
        fn: "Kundanben",
        ln: "Shah",
        phone: "9999999999",
        aadhar: "123456789012",
        status: "Active"
      },
      { actor: ACTOR }
    );

    const dupName = await employeeService.create(
      {
        fn: "kundanben",
        ln: "shah",
        phone: "8888888888",
        aadhar: "999999999999",
        status: "Active"
      },
      { actor: ACTOR }
    );
    expect(dupName.success).toBe(false);
    expect(dupName.code).toBe("duplicate");
    expect((dupName.details as { field: string }).field).toBe("name");

    const dupAadhar = await employeeService.create(
      {
        fn: "Other",
        ln: "Person",
        phone: "7777777777",
        aadhar: "123456789012",
        status: "Active"
      },
      { actor: ACTOR }
    );
    expect(dupAadhar.success).toBe(false);
    expect((dupAadhar.details as { field: string }).field).toBe("aadhar");

    const allowed = await employeeService.create(
      {
        fn: "kundanben",
        ln: "shah",
        phone: "8888888888",
        aadhar: "999999999999",
        confirm_duplicate_name: true,
        status: "Active"
      },
      { actor: ACTOR }
    );
    expect(allowed.success).toBe(true);
    expect(employees.length).toBe(2);
  });

  it("blocks status change via update PATCH (must use setStatus)", async () => {
    const created = await employeeService.create(
      { fn: "Status", ln: "Guard", phone: "9876500009", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const result = await employeeService.update(
      id,
      {
        fn: "Status",
        ln: "Guard",
        phone: "9876500009",
        status: "Inactive",
        expected_updated_at: String(employees[0].updated_at || "")
      },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
    expect(employees[0].status).toBe("Active");
  });

  it("rejects update when expected_updated_at is omitted", async () => {
    const created = await employeeService.create(
      { fn: "No", ln: "Version", phone: "9876512346", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const result = await employeeService.update(
      id,
      { fn: "No", ln: "Version", phone: "9876512346" },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("validation_error");
  });

  it("returns conflict when expected_updated_at is stale", async () => {
    const created = await employeeService.create(
      { fn: "Stale", ln: "Edit", phone: "9876512345", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const result = await employeeService.update(
      id,
      {
        fn: "Stale",
        ln: "Edit",
        phone: "9876512345",
        expected_updated_at: "2020-01-01T00:00:00.000Z"
      },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
  });

  it("setStatus OnLeave persists explicit status and leave_date", async () => {
    const created = await employeeService.create(
      { fn: "Leave", ln: "Test", phone: "9876500001", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const changed = await employeeService.setStatus(
      id,
      { status: "OnLeave", reason: "Vacation" },
      { actor: ACTOR }
    );
    expect(changed.success).toBe(true);
    expect(employees[0].status).toBe("OnLeave");
    expect(String(employees[0].leave_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("remove soft-deactivates when historical links exist", async () => {
    const created = await employeeService.create(
      { fn: "Linked", ln: "Worker", phone: "9876500002", status: "Active" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    duties.push({ employee_id: id });
    const removed = await employeeService.remove(id, { actor: ACTOR }, { reason: "Left company" });
    expect(removed.success).toBe(true);
    expect((removed.data as { mode: string }).mode).toBe("soft");
    expect(employees[0].status).toBe("Inactive");
    const audit = audits.find((a) => a.entity_id === id && a.action === "delete");
    expect(String(audit?.stamp || "")).toContain("Left company");
  });
});
