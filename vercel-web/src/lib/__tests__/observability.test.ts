import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isObservabilityEnabled } from "@/lib/observability";

describe("observability", () => {
  const prevDsn = process.env.SENTRY_DSN;
  const prevPublic = process.env.NEXT_PUBLIC_SENTRY_DSN;

  afterEach(() => {
    if (prevDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prevDsn;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = prevPublic;
  });

  it("is disabled without DSN", () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(isObservabilityEnabled()).toBe(false);
  });

  it("is enabled when SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    expect(isObservabilityEnabled()).toBe(true);
  });
});
