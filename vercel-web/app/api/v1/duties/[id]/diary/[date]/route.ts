import type { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { respond } from "@/lib/api/apiResultBridge";
import { badRequest } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string; date: string };

const diaryPatchSchema = z
  .object({
    employee_id: z.string().min(1).optional(),
    new_employee_id: z.string().min(1).optional(),
    charge: z
      .union([z.number(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return undefined;
        return n;
      }),
    payout: z
      .union([z.number(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return undefined;
        return n;
      }),
    clear_manual: z.boolean().optional().default(false),
    /** Optimistic concurrency: client passes the row's updated_at to
     *  refuse the write on a stale base. */
    svc_updated_at: z.string().min(1).optional(),
    payout_updated_at: z.string().min(1).optional()
  })
  .strict();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PATCH /api/v1/duties/[id]/diary/[date]
 *
 * Body (Zod-validated):
 *   { employee_id, new_employee_id?, charge?, payout?, clear_manual?,
 *     svc_updated_at?, payout_updated_at? }
 *
 * Updates the per-day diary slot for that duty × date × partner. The
 * row is marked manual so subsequent `materialize` calls won't reset
 * it back to the duty defaults. Send `clear_manual: true` to release
 * the lock.
 *
 * Optimistic concurrency: callers may include `svc_updated_at` /
 * `payout_updated_at` from the most recent listDays response; if the
 * server-side timestamps moved since, the request is refused with a
 * conflict error.
 */
export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  if (!ISO_DATE.test(params.date)) {
    throw badRequest("date must be YYYY-MM-DD");
  }
  // P1-33: do NOT swallow parse errors. The old `.catch(() => ({}))` mapped
  // a malformed JSON body to an empty object, which then sailed past the
  // schema (every field optional) and submitted an empty patch — a
  // no-op write that still bumped updated_at and confused the audit log.
  // Let parseJsonBody throw a real 400 so the client sees the failure.
  const raw = await parseJsonBody(req);
  const parsed = diaryPatchSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw badRequest("Invalid diary patch", parsed.error.flatten());
  }
  const body = parsed.data;
  const url = new URL(req.url);
  const employeeId = (body.employee_id || url.searchParams.get("employee_id") || "").trim();
  if (!employeeId) throw badRequest("employee_id is required");

  const result = await dutyDiaryService.updateDay(
    params.id,
    params.date,
    employeeId,
    {
      charge: body.charge,
      payout: body.payout,
      new_employee_id: body.new_employee_id,
      clear_manual: body.clear_manual,
      svc_updated_at: body.svc_updated_at,
      payout_updated_at: body.payout_updated_at
    },
    { actor }
  );
  return respond(result);
});

/**
 * DELETE /api/v1/duties/[id]/diary/[date]?employee_id=...
 *
 * Removes the per-day diary slot. The next materialize will re-create
 * it from defaults unless the duty's window is also shrunk to exclude
 * the date.
 */
export const DELETE = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  if (!ISO_DATE.test(params.date)) {
    throw badRequest("date must be YYYY-MM-DD");
  }
  const url = new URL(req.url);
  const employeeId = (url.searchParams.get("employee_id") || "").trim();
  if (!employeeId) throw badRequest("employee_id is required");

  const result = await dutyDiaryService.deleteDay(params.id, params.date, employeeId, { actor });
  return respond(result);
});
