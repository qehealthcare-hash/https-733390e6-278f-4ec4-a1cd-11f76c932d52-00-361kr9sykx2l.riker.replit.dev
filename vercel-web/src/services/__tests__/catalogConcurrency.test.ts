import { beforeEach, describe, expect, it, vi } from "vitest";
import { doctorService } from "@/services/doctorService";
import { vendorService } from "@/services/vendorService";
import { userService } from "@/services/userService";
import { doctorRepository } from "@/database/doctorRepository";
import { vendorRepository } from "@/database/vendorRepository";
import { userRepository } from "@/database/userRepository";

vi.mock("@/database/doctorRepository");
vi.mock("@/database/vendorRepository");
vi.mock("@/database/userRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "admin@test.com", accessToken: "tok", role: "Admin" } };

const updatedAt = "2026-06-01T12:00:00.000Z";

describe("catalog services optimistic concurrency (P2-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("doctorService.update returns conflict on stale expected_updated_at", async () => {
    vi.mocked(doctorRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "DOC00001", fn: "Ada", updated_at: updatedAt }
    });

    const result = await doctorService.update(
      "DOC00001",
      { fn: "Ada", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(doctorRepository.update).not.toHaveBeenCalled();
  });

  it("doctorService.update proceeds when expected_updated_at matches", async () => {
    vi.mocked(doctorRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "DOC00001", fn: "Ada", updated_at: updatedAt }
    });
    vi.mocked(doctorRepository.update).mockResolvedValue({
      success: true,
      data: { id: "DOC00001", fn: "Ada", ln: "Lovelace", updated_at: updatedAt }
    });

    const result = await doctorService.update(
      "DOC00001",
      { ln: "Lovelace", expected_updated_at: updatedAt },
      ctx
    );

    expect(result.success).toBe(true);
    expect(doctorRepository.update).toHaveBeenCalled();
  });

  it("vendorService.update returns conflict on stale expected_updated_at", async () => {
    vi.mocked(vendorRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "VEN00001", name: "Acme", updated_at: updatedAt }
    });

    const result = await vendorService.update(
      "VEN00001",
      { name: "Acme", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(vendorRepository.update).not.toHaveBeenCalled();
  });

  it("userService.updateUser returns conflict on stale expected_updated_at", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "USR00001", username: "staff1", updated_at: updatedAt }
    });

    const result = await userService.updateUser(
      "USR00001",
      { phone: "9999999999", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it("userService.updateUser proceeds when expected_updated_at matches", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "USR00001", username: "staff1", updated_at: updatedAt }
    });
    vi.mocked(userRepository.update).mockResolvedValue({
      success: true,
      data: { id: "USR00001", username: "staff1", phone: "9999999999", updated_at: updatedAt }
    });

    const result = await userService.updateUser(
      "USR00001",
      { phone: "9999999999", expected_updated_at: updatedAt },
      ctx
    );

    expect(result.success).toBe(true);
    expect(userRepository.update).toHaveBeenCalled();
  });
});
