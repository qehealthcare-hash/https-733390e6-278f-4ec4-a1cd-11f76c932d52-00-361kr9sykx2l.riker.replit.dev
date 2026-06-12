import { afterEach, describe, expect, it, vi } from "vitest";
import { hasRefreshSessionHint } from "@/lib/auth/sessionHint";

describe("hasRefreshSessionHint", () => {
  afterEach(function () {
    vi.unstubAllGlobals();
  });

  it("returns false in non-browser environments", () => {
    expect(hasRefreshSessionHint()).toBe(false);
  });

  it("returns false when the session hint cookie is absent", () => {
    vi.stubGlobal("document", { cookie: "other=value" });
    expect(hasRefreshSessionHint()).toBe(false);
  });

  it("returns true when hhcrm_session=1 is present", () => {
    vi.stubGlobal("document", { cookie: "hhcrm_session=1; other=value" });
    expect(hasRefreshSessionHint()).toBe(true);
  });
});
