/**
 * @deprecated Use `@/services/attendanceService` instead.
 *
 * Re-exports for code that still imports `attendanceSchema` /
 * `attendanceService` from this legacy path. New routes use the layered
 * service in `src/services/attendanceService.ts` which returns `ApiResult<T>`.
 */

import { attendanceService as layeredAttendanceService } from "@/services/attendanceService";
import type { ActorContext } from "@/lib/api/auth";
import type { AttendanceInput } from "@/validation/attendanceValidation";
import { unwrap } from "@/lib/api/apiResultBridge";

export {
  attendanceSchema,
  attendanceListQuerySchema,
  type AttendanceInput,
  type AttendanceListQuery
} from "@/validation/attendanceValidation";

/**
 * Legacy "throw on failure" facade — converts `ApiResult` from the new
 * layered service into the throw-based shape expected by old call sites.
 */
export const attendanceService = {
  async list(opts: {
    limit: number;
    offset: number;
    employeeId?: string;
    dutyId?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    return unwrap(
      await layeredAttendanceService.list(
        {
          limit: opts.limit,
          offset: opts.offset,
          employee_id: opts.employeeId,
          duty_id: opts.dutyId,
          status: opts.status,
          from: opts.from,
          to: opts.to
        },
        { actor: { email: "system" } }
      )
    );
  },

  async getById(id: string) {
    return unwrap(
      await layeredAttendanceService.getById(id, { actor: { email: "system" } })
    );
  },

  async create(input: AttendanceInput, actor: ActorContext) {
    return unwrap(await layeredAttendanceService.create(input, { actor }));
  },

  async update(id: string, input: AttendanceInput, actor: ActorContext) {
    return unwrap(await layeredAttendanceService.update(id, input, { actor }));
  },

  async remove(id: string, actor: ActorContext) {
    return unwrap(await layeredAttendanceService.remove(id, { actor }));
  }
};
