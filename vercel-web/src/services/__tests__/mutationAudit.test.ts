import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@/types/common";

vi.mock("@/database/auditRepository", () => ({
  auditRepository: {
    insert: vi.fn()
  }
}));

vi.mock("@/lib/api/env", () => ({
  env: { auditDisabled: false }
}));

import { auditRepository } from "@/database/auditRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";

const insertMock = vi.mocked(auditRepository.insert);

describe("mutationAudit — Phase 9 enforcement", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("returns success when audit insert succeeds", async () => {
    insertMock.mockResolvedValue({ success: true, data: { id: "AUD1" } });
    const result = await writeMutationAudit(undefined, "staff@hominal.test", {
      module: "patient",
      entity_id: "PID000001",
      action: "create"
    });
    expect(result.success).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("returns audit_write_failed when insert fails", async () => {
    insertMock.mockResolvedValue({
      success: false,
      error: "RLS denied"
    });
    const result = await writeMutationAudit(undefined, "staff@hominal.test", {
      module: "patient",
      entity_id: "PID000001",
      action: "update"
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe(ErrorCodes.audit);
  });

  it("finalizeWithAudit blocks API success on audit failure", () => {
    const blocked = finalizeWithAudit(
      {
        success: false,
        error: "Audit log write failed",
        code: ErrorCodes.audit
      },
      { id: "PID000001" }
    );
    expect(blocked.success).toBe(false);
    expect(blocked.code).toBe(ErrorCodes.audit);
    expect((blocked.details as { persisted?: boolean }).persisted).toBe(true);
  });

  it("finalizeWithAudit passes data through on audit success", () => {
    const ok = finalizeWithAudit({ success: true, data: null }, { id: "PID000001" });
    expect(ok.success).toBe(true);
    expect(ok.data).toEqual({ id: "PID000001" });
  });
});
