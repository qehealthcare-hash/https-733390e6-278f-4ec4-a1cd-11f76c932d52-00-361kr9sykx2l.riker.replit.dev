/** Canonical attendance row fixture for route / contract tests. */
export function attendanceRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "ATT2026050001",
    employee_id: "EMP2026050001",
    duty_id: "DUTY2026050001",
    status: "PRESENT",
    work_date: "2026-05-25",
    check_in_at: "2026-05-25T09:00:00.000+05:30",
    check_out_at: null,
    hours: 0,
    notes: "",
    ...overrides
  };
}

/** Empty day-board summary — all counters zero. */
export function attendanceDayBoardSummaryFixture(
  overrides: Record<string, number> = {}
) {
  return {
    total: 0,
    scheduled: 0,
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    leave: 0,
    holiday: 0,
    completed: 0,
    in_progress: 0,
    unmarked: 0,
    ...overrides
  };
}

/** Empty range-board summary — extends day summary with monetary totals. */
export function attendanceRangeBoardSummaryFixture(
  overrides: Record<string, number> = {}
) {
  return {
    ...attendanceDayBoardSummaryFixture(),
    total_hours: 0,
    total_charge: 0,
    total_payout: 0,
    ...overrides
  };
}
