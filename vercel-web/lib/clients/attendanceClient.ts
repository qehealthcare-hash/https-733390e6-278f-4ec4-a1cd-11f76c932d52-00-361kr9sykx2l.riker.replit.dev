import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  attendanceDayBoardDtoSchema,
  attendanceDeleteResultDtoSchema,
  attendanceMissingListDtoSchema,
  attendanceRangeBoardDtoSchema,
  attendanceRowDtoSchema,
} from "@/validation/attendanceDto";

export const ATTENDANCE_BASE = "/attendance";

export const attendanceClient = {
  dayBoard(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(ATTENDANCE_BASE + "/day", params), null, session, attendanceDayBoardDtoSchema);
  },

  markDay(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      ATTENDANCE_BASE + "/day/mark",
      { method: "POST", body },
      session,
      attendanceRowDtoSchema
    );
  },

  range(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(ATTENDANCE_BASE + "/range", params), null, session, attendanceRangeBoardDtoSchema);
  },

  missing(
    session: ApiSession,
    params: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(ATTENDANCE_BASE + "/missing", params), null, session, attendanceMissingListDtoSchema);
  },

  mark(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(ATTENDANCE_BASE + "/mark", { method: "POST", body }, session, attendanceRowDtoSchema);
  },

  update(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      ATTENDANCE_BASE + "/" + encodeURIComponent(id),
      { method: "PATCH", body },
      session,
      attendanceRowDtoSchema
    );
  },

  remove(session: ApiSession, id: string, body?: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      ATTENDANCE_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || undefined },
      session,
      attendanceDeleteResultDtoSchema
    );
  }
};
