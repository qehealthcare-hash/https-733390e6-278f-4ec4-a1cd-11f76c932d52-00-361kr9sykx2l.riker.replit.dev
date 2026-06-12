import { describe, expect, it } from "vitest";
import { attendanceExpectedUpdatedAt } from "@/lib/attendanceUi";

describe("attendanceUi concurrency helpers", () => {
  it("prefers attendance_updated_at from day board rows", () => {
    expect(
      attendanceExpectedUpdatedAt({
        updated_at: "2020-01-01T00:00:00.000Z",
        attendance_updated_at: "2026-06-01T12:00:00.000Z"
      })
    ).toBe("2026-06-01T12:00:00.000Z");
  });

  it("falls back to log row updated_at", () => {
    expect(attendanceExpectedUpdatedAt({ updated_at: "2026-06-01T12:00:00.000Z" })).toBe(
      "2026-06-01T12:00:00.000Z"
    );
  });
});
