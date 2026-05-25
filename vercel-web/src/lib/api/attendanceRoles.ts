/** Roles allowed to read attendance data (list, day board, range, missing). */
export const ATTENDANCE_READ_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Nurse",
  "Supervisor"
] as const;

/** Roles allowed to create/update/delete attendance records. */
export const ATTENDANCE_WRITE_ROLES = [
  "Admin",
  "Manager",
  "Staff",
  "Nurse",
  "Supervisor"
] as const;
