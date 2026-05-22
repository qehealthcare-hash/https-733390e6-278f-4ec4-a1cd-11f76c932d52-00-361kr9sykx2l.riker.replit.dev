import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/database/auditRepository", () => ({
  auditRepository: {
    insert: vi.fn()
  }
}));

vi.mock("@/lib/api/env", () => ({
  env: { auditDisabled: false }
}));

import { auditRepository } from "@/database/auditRepository";
import { writeMutationAudit } from "@/services/mutationAudit";

const insertMock = vi.mocked(auditRepository.insert);

describe("audit trail — row shape", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it("persists module, action, entity_id, before/after, actor, and user_id", async () => {
    await writeMutationAudit(undefined, {
      email: "admin@hominal.test",
      userId: "USR0001"
    }, {
      module: "patient",
      entity_id: "PID000099",
      action: "update",
      before: { status: "Active" },
      after: { status: "Active", name: "Test" }
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "patient",
        entity_id: "PID000099",
        action: "update",
        actor: "admin@hominal.test",
        user_id: "USR0001",
        before: { status: "Active" },
        after: { status: "Active", name: "Test" }
      }),
      undefined
    );
  });

  it("maps semantic close action for billing/payout flows", async () => {
    await writeMutationAudit(undefined, { email: "acct@hominal.test" }, {
      module: "billing",
      entity_id: "INVE000010",
      action: "close",
      before: { status: "Active" },
      after: { status: "Closed" }
    });

    expect(insertMock.mock.calls[0][0].action).toBe("close");
  });
});
