import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api/env", () => ({
  env: { openaiApiKey: "sk-test" },
  hasOpenAI: () => true
}));

vi.mock("@/database/aiRepository", () => ({
  aiRepository: {
    findConversation: vi.fn(),
    insertConversation: vi.fn(),
    insertMessage: vi.fn(),
    recentPatients: vi.fn(),
    activePatientsWithoutCaretaker: vi.fn(),
    activeBillings: vi.fn(),
    recentReceipts: vi.fn(),
    upcomingDuties: vi.fn(),
    dutyGaps: vi.fn()
  }
}));

vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: { id: 1 } })
}));

import { aiRepository } from "@/database/aiRepository";
import { aiService } from "@/services/aiService";

function stubAiContext() {
  vi.mocked(aiRepository.recentPatients).mockResolvedValue({ success: true, data: [] });
  vi.mocked(aiRepository.activePatientsWithoutCaretaker).mockResolvedValue({
    success: true,
    data: []
  });
  vi.mocked(aiRepository.activeBillings).mockResolvedValue({ success: true, data: [] });
  vi.mocked(aiRepository.recentReceipts).mockResolvedValue({ success: true, data: [] });
  vi.mocked(aiRepository.upcomingDuties).mockResolvedValue({ success: true, data: [] });
  vi.mocked(aiRepository.dutyGaps).mockResolvedValue({ success: true, data: [] });
}

describe("aiService — conversation access on ask", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    stubAiContext();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "answer" } }],
        usage: {}
      })
    }) as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects continuing another user's conversation for Staff", async () => {
    vi.mocked(aiRepository.findConversation).mockResolvedValue({
      success: true,
      data: { id: "CONV1", actor: "other@hominal.test" }
    });

    const result = await aiService.ask(
      {
        question: "hello",
        scope: "all",
        conversation_id: "CONV1"
      },
      { actor: { email: "staff@hominal.test", role: "Staff", userId: "U1", username: "s" } }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("forbidden");
    }
    expect(aiRepository.insertMessage).not.toHaveBeenCalled();
  });

  it("allows Admin to continue any conversation", async () => {
    vi.mocked(aiRepository.findConversation).mockResolvedValue({
      success: true,
      data: { id: "CONV1", actor: "other@hominal.test" }
    });
    vi.mocked(aiRepository.insertMessage).mockResolvedValue({
      success: true,
      data: { id: "MSG1" }
    });

    const result = await aiService.ask(
      {
        question: "hello",
        scope: "all",
        conversation_id: "CONV1"
      },
      { actor: { email: "admin@hominal.test", role: "Admin", userId: "A1", username: "a" } }
    );

    expect(result.success).toBe(true);
    expect(aiRepository.insertMessage).toHaveBeenCalled();
  });
});
