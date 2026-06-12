import { describe, expect, it, vi } from "vitest";
import { confirmDiscardTyped } from "@/lib/modalDiscard";

describe("confirmDiscardTyped", () => {
  it("closes immediately when there is no typed input", () => {
    const confirm = vi.fn();
    const onDiscard = vi.fn();
    confirmDiscardTyped(confirm, false, onDiscard);
    expect(confirm).not.toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation when there is typed input", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const onDiscard = vi.fn();
    confirmDiscardTyped(confirm, true, onDiscard);
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("does not discard when confirmation is declined", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const onDiscard = vi.fn();
    confirmDiscardTyped(confirm, true, onDiscard);
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
