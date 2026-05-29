import { describe, expect, it } from "vitest";
import {
  emptyMarkForm,
  istDayKey,
  isoDateTime,
  startOfWeek,
  todayDate
} from "@/lib/attendanceUi";

describe("attendanceUi", () => {
  it("istDayKey uses IST calendar day, not UTC slice", () => {
    // 2026-05-25 20:00 UTC = 2026-05-26 01:30 IST
    expect(istDayKey("2026-05-25T20:00:00.000Z")).toBe("2026-05-26");
  });

  it("isoDateTime appends IST offset", () => {
    expect(isoDateTime("2026-05-25", "09:30")).toBe("2026-05-25T09:30:00.000+05:30");
    expect(isoDateTime("2026-05-25")).toBe("2026-05-25T09:00:00.000+05:30");
  });

  it("startOfWeek returns YYYY-MM-DD on or before today", () => {
    const start = startOfWeek();
    const today = todayDate();
    expect(start <= today).toBe(true);
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("emptyMarkForm defaults work_date to today", () => {
    const form = emptyMarkForm();
    expect(form.work_date).toBe(todayDate());
    expect(form.status).toBe("PRESENT");
  });
});
