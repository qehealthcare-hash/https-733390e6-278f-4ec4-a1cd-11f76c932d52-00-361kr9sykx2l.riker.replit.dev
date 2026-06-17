import { describe, expect, it, vi, afterEach } from "vitest";
import { isRealtimeEnabled } from "@/lib/realtimeConfig";

describe("isRealtimeEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_REALTIME", undefined);
    expect(isRealtimeEnabled()).toBe(true);
  });

  it("disables when env is 0", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_REALTIME", "0");
    expect(isRealtimeEnabled()).toBe(false);
  });
});
