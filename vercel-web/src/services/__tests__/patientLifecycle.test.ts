/**
 * Integration test — patient lifecycle through every business + validation
 * gate the API actually exercises. Stubs out the repository / audit layer
 * with in-memory fakes so the test runs without Supabase, but still drives
 * the real `patientService` code paths.
 *
 * Covers: create → duplicate-name guard → confirm override → edit (status
 * preservation + optimistic locking conflict) → close (audit reason) →
 * reopen (with note) → hard-delete refused for linked rows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { patientService } from "@/services/patientService";

type Row = Record<string, unknown>;

const employees: Row[] = [{ id: "EMP1", full_name: "Test Caretaker" }];
let patients: Row[] = [];
let audits: Row[] = [];
let billings: Row[] = [];
let duties: Row[] = [];

function nowIso() { return new Date().toISOString(); }

vi.mock("@/database/patientRepository", () => ({
  patientRepository: {
    async findById(id: string) {
      const row = patients.find((p) => p.id === id) || null;
      return { success: true as const, data: row };
    },
    async list() {
      return { success: true as const, data: { rows: patients, total: patients.length } };
    },
    async insert(row: Row) {
      patients.push({ ...row, created_at: nowIso(), updated_at: nowIso() });
      return { success: true as const, data: patients[patients.length - 1] };
    },
    async update(id: string, patch: Row) {
      const idx = patients.findIndex((p) => p.id === id);
      if (idx < 0) return { success: false as const, error: "not found", code: "not_found" };
      patients[idx] = { ...patients[idx], ...patch, updated_at: nowIso() };
      return { success: true as const, data: patients[idx] };
    },
    async remove(id: string) {
      const before = patients.length;
      patients = patients.filter((p) => p.id !== id);
      return patients.length < before
        ? { success: true as const, data: null }
        : { success: false as const, error: "not found", code: "not_found" };
    },
    async findActiveByPhoneSuffix(phone: string, excludeId?: string) {
      const suffix = phone.replace(/\D/g, "").slice(-8);
      const rows = patients.filter(
        (p) =>
          p.status === "Active" &&
          String(p.phone || "").includes(suffix) &&
          p.id !== excludeId
      );
      return { success: true as const, data: rows };
    },
    async findActiveByName(name: string, excludeId?: string) {
      const key = name.trim().toLowerCase();
      const rows = patients.filter(
        (p) =>
          p.status === "Active" &&
          String(p.name || "").trim().toLowerCase() === key &&
          p.id !== excludeId
      );
      return { success: true as const, data: rows };
    },
    async countBillings(patientId: string) {
      return { success: true as const, data: billings.filter((b) => b.patient_id === patientId).length };
    },
    async countDuties(patientId: string) {
      return { success: true as const, data: duties.filter((d) => d.patient_id === patientId).length };
    },
    async listHistoryBillings(patientId: string) {
      return { success: true as const, data: billings.filter((b) => b.patient_id === patientId) };
    },
    async listHistoryDuties(patientId: string) {
      return { success: true as const, data: duties.filter((d) => d.patient_id === patientId) };
    },
    async listHistoryAudits(patientId: string) {
      return { success: true as const, data: audits.filter((a) => a.entity_id === patientId) };
    },
    async listReceiptsForBillings() {
      return { success: true as const, data: [] };
    }
  }
}));

vi.mock("@/database/employeeRepository", () => ({
  employeeRepository: {
    async findById(id: string) {
      return { success: true as const, data: employees.find((e) => e.id === id) || null };
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

const ACTOR = { id: "u1", email: "admin@test", role: "Admin", accessToken: "" };

beforeEach(() => {
  patients = [];
  audits = [];
  billings = [];
  duties = [];
});

describe("patient lifecycle — create → edit → close → reopen → delete", () => {
  it("creates a patient and preserves status on partial edit", async () => {
    const created = await patientService.create(
      { name: "Asha Verma", phone: "9876543210", city: "Ahmedabad" },
      { actor: ACTOR }
    );
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;
    expect(patients[0].status).toBe("Active");

    // Edit without sending status — must not silently flip to Active even
    // after status was changed out-of-band.
    patients[0].status = "Duty Closed";
    const edited = await patientService.update(
      id,
      { name: "Asha Verma", phone: "9876543210", area: "Naranpura" },
      { actor: ACTOR }
    );
    expect(edited.success).toBe(true);
    expect(patients[0].status).toBe("Duty Closed");
    expect(patients[0].area).toBe("Naranpura");
  });

  it("blocks an active duplicate name and respects confirm_duplicate_name", async () => {
    await patientService.create(
      { name: "Kundanben Shah", phone: "9999999999" },
      { actor: ACTOR }
    );

    const dupBlocked = await patientService.create(
      { name: "kundanben shah", phone: "8888888888" },
      { actor: ACTOR }
    );
    expect(dupBlocked.success).toBe(false);
    expect(dupBlocked.code).toBe("duplicate");
    expect((dupBlocked.details as { field: string }).field).toBe("name");

    const dupAllowed = await patientService.create(
      { name: "kundanben shah", phone: "8888888888", confirm_duplicate_name: true },
      { actor: ACTOR }
    );
    expect(dupAllowed.success).toBe(true);
    expect(patients.length).toBe(2);
  });

  it("blocks status change via update PATCH (must use close/reopen)", async () => {
    const created = await patientService.create(
      { name: "Status Guard", phone: "9876500009" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const result = await patientService.update(
      id,
      { name: "Status Guard", phone: "9876500009", status: "Closed" },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
    expect(patients[0].status).toBe("Active");
  });

  it("returns conflict when expected_updated_at is stale", async () => {
    const created = await patientService.create(
      { name: "Stale Edit", phone: "9876512345" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const stale = "2020-01-01T00:00:00.000Z";
    const result = await patientService.update(
      id,
      { name: "Stale Edit", phone: "9876512345", expected_updated_at: stale },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
  });

  it("close stores the reason in the audit stamp, reopen restores Active", async () => {
    const created = await patientService.create(
      { name: "Close Cycle", phone: "9876511223" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;

    const closed = await patientService.remove(id, { actor: ACTOR }, {
      reason: "Recovered"
    });
    expect(closed.success).toBe(true);
    expect(patients[0].status).toBe("Closed");
    const closeAudit = audits.find((a) => a.entity_id === id && a.action === "deactivate");
    expect(closeAudit?.stamp).toContain("Recovered");

    const reopened = await patientService.reopen(id, { actor: ACTOR }, {
      reason: "Returned from hospital"
    });
    expect(reopened.success).toBe(true);
    expect(patients[0].status).toBe("Active");
    const reopenAudit = audits.find((a) => a.entity_id === id && a.action === "restore");
    expect(reopenAudit?.stamp).toContain("Returned from hospital");
  });

  it("hard delete is refused when linked billings exist", async () => {
    const created = await patientService.create(
      { name: "Linked Patient", phone: "9876500001" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    billings.push({ id: "B1", patient_id: id });

    await patientService.remove(id, { actor: ACTOR }, { reason: "Discharged" });
    expect(patients[0].status).toBe("Closed");

    const hard = await patientService.removePermanent(id, { actor: ACTOR });
    expect(hard.success).toBe(false);
    expect(hard.code).toBe("business_rule_violation");
    expect(patients.length).toBe(1);

    billings = [];
    const hardAgain = await patientService.removePermanent(id, { actor: ACTOR });
    expect(hardAgain.success).toBe(true);
    expect(patients.length).toBe(0);
  });
});
