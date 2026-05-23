/**
 * Integration test — inquiry lifecycle through validation + business gates.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { inquiryService } from "@/services/inquiryService";

type Row = Record<string, unknown>;

let inquiries: Row[] = [];
let patients: Row[] = [];
let audits: Row[] = [];

const OPEN_INQUIRY_STATUSES = ["New", "Contacted", "FollowUp", "Negotiating"];

function nowIso() {
  return new Date().toISOString();
}

vi.mock("@/database/inquiryRepository", () => ({
  inquiryRepository: {
    async findById(id: string) {
      return { success: true as const, data: inquiries.find((r) => r.id === id) || null };
    },
    async list() {
      return { success: true as const, data: { rows: inquiries, total: inquiries.length } };
    },
    async insert(row: Row) {
      const next = { ...row, created_at: nowIso(), updated_at: nowIso() };
      inquiries.push(next);
      return { success: true as const, data: next };
    },
    async update(id: string, patch: Row) {
      const idx = inquiries.findIndex((r) => r.id === id);
      if (idx < 0) return { success: false as const, error: "not found", code: "not_found" };
      inquiries[idx] = { ...inquiries[idx], ...patch, updated_at: nowIso() };
      return { success: true as const, data: inquiries[idx] };
    },
    async remove(id: string) {
      const before = inquiries.length;
      inquiries = inquiries.filter((r) => r.id !== id);
      return inquiries.length < before
        ? { success: true as const, data: null }
        : { success: false as const, error: "not found", code: "not_found" };
    },
    async findActiveByPhone(phone: string, excludeId?: string) {
      const suffix = phone.replace(/\D/g, "").slice(-8);
      const rows = inquiries.filter(
        (r) =>
          OPEN_INQUIRY_STATUSES.includes(String(r.status)) &&
          String(r.phone || "").includes(suffix) &&
          r.id !== excludeId
      );
      return { success: true as const, data: rows };
    },
    async findPatientByPhone(phone: string) {
      const suffix = phone.replace(/\D/g, "").slice(-8);
      const row = patients.find((p) => String(p.phone || "").includes(suffix));
      return { success: true as const, data: row || null };
    },
    async convertRpc(inquiryId: string) {
      const inq = inquiries.find((r) => r.id === inquiryId);
      if (!inq) return { success: false as const, error: "not found", code: "not_found" };
      const pid = "PID_FROM_INQ";
      patients.push({ id: pid, name: inq.name, phone: inq.phone, status: "Active" });
      inq.status = "Converted";
      return { success: true as const, data: { patient_id: pid, inquiry_id: inquiryId } };
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
  inquiries = [];
  patients = [];
  audits = [];
});

describe("inquiry lifecycle", () => {
  it("creates an inquiry and preserves status on partial edit", async () => {
    const created = await inquiryService.create(
      { name: "Lead One", phone: "9876543210", status: "New" },
      { actor: ACTOR }
    );
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;
    inquiries[0].status = "Contacted";

    const edited = await inquiryService.update(
      id,
      { name: "Lead One", phone: "9876543210", area: "Satellite" },
      { actor: ACTOR }
    );
    expect(edited.success).toBe(true);
    expect(inquiries[0].status).toBe("Contacted");
    expect(inquiries[0].area).toBe("Satellite");
  });

  it("blocks duplicate open phone and existing patient unless confirmed", async () => {
    await inquiryService.create({ name: "First", phone: "9999888877", status: "New" }, { actor: ACTOR });

    const dup = await inquiryService.create({ name: "Second", phone: "9999888877", status: "New" }, { actor: ACTOR });
    expect(dup.success).toBe(false);
    expect(dup.code).toBe("duplicate");

    patients.push({ id: "PID1", name: "Existing Pat", phone: "8888777766", status: "Active" });
    const blocked = await inquiryService.create(
      { name: "Lead", phone: "8888777766", status: "New" },
      { actor: ACTOR }
    );
    expect(blocked.success).toBe(false);
    expect((blocked.details as { field: string }).field).toBe("phone_existing_patient");

    const allowed = await inquiryService.create(
      { name: "Lead", phone: "8888777766", status: "New", confirm_existing_patient: true },
      { actor: ACTOR }
    );
    expect(allowed.success).toBe(true);
  });

  it("returns conflict when expected_updated_at is stale", async () => {
    const created = await inquiryService.create(
      { name: "Stale", phone: "9876512345", status: "New" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const result = await inquiryService.update(
      id,
      { name: "Stale", phone: "9876512345", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      { actor: ACTOR }
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
  });

  it("setStatus to Lost requires reason when reopening from Closed", async () => {
    const created = await inquiryService.create(
      { name: "Status Flow", phone: "9876500001", status: "New" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;

    const lost = await inquiryService.setStatus(
      id,
      { status: "Lost", reason: "No budget" },
      { actor: ACTOR }
    );
    expect(lost.success).toBe(true);

    const reopenBlocked = await inquiryService.setStatus(
      id,
      { status: "New", reason: "" },
      { actor: ACTOR }
    );
    expect(reopenBlocked.success).toBe(false);

    const reopened = await inquiryService.setStatus(
      id,
      { status: "New", reason: "Called back" },
      { actor: ACTOR }
    );
    expect(reopened.success).toBe(true);
    expect(inquiries[0].status).toBe("New");
  });

  it("convert marks inquiry Converted and is idempotent", async () => {
    const created = await inquiryService.create(
      { name: "Convert Me", phone: "9876500002", status: "New" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const converted = await inquiryService.convertToPatient(id, { notes: "Ready" }, { actor: ACTOR });
    expect(converted.success).toBe(true);
    expect(inquiries[0].status).toBe("Converted");

    const again = await inquiryService.convertToPatient(id, {}, { actor: ACTOR });
    expect(again.success).toBe(true);
    expect((again.data as { alreadyConverted: boolean }).alreadyConverted).toBe(true);
  });

  it("remove soft-closes by default", async () => {
    const created = await inquiryService.create(
      { name: "Delete Me", phone: "9876500003", status: "New" },
      { actor: ACTOR }
    );
    const id = (created.data as { id: string }).id;
    const removed = await inquiryService.remove(id, { actor: ACTOR }, { reason: "Spam" });
    expect(removed.success).toBe(true);
    expect((removed.data as { mode: string }).mode).toBe("soft");
    expect(inquiries[0].status).toBe("Closed");
  });
});
