import { describe, it } from "vitest";
import { assertNotStale } from "@/business/concurrencyRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("concurrencyRules.assertNotStale", () => {
  it("passes when client did not opt in (no expected_updated_at)", () => {
    expectOk(assertNotStale("Billing", "2026-05-23T10:00:00Z", undefined));
    expectOk(assertNotStale("Billing", "2026-05-23T10:00:00Z", ""));
    expectOk(assertNotStale("Billing", "2026-05-23T10:00:00Z", null));
  });

  it("passes when timestamps match to the second", () => {
    expectOk(
      assertNotStale(
        "Billing",
        "2026-05-23T10:00:00.123Z",
        "2026-05-23T10:00:00.987Z"
      )
    );
  });

  it("passes when persisted row is older than the client's expectation", () => {
    expectOk(
      assertNotStale(
        "Billing",
        "2026-05-23T09:00:00Z",
        "2026-05-23T10:00:00Z"
      )
    );
  });

  it("fails when persisted row is newer than the client's expectation", () => {
    expectFail(
      assertNotStale(
        "Billing",
        "2026-05-23T10:01:00Z",
        "2026-05-23T10:00:00Z"
      ),
      ErrorCodes.conflict
    );
  });

  it("passes when actual_updated_at is missing (cannot prove staleness)", () => {
    expectOk(assertNotStale("Payout", null, "2026-05-23T10:00:00Z"));
    expectOk(assertNotStale("Payout", "", "2026-05-23T10:00:00Z"));
  });

  it("passes when expected_updated_at is unparseable", () => {
    expectOk(
      assertNotStale("Payout", "2026-05-23T10:00:00Z", "not-a-date")
    );
  });
});
