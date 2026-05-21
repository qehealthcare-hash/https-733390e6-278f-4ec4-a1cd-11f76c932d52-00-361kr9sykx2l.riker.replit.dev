import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { payoutRunSchema, payoutPaymentSchema } from "../validators/payout.validator.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { payoutService } from "../services/payout.service.js";
import { recordAuditLog } from "../lib/audit.js";

export const payoutRouter = express.Router();

payoutRouter.get(
  "/",
  requireAuth,
  requirePermission("payouts.read"),
  asyncHandler(async function listPayouts(req, res) {
    const data = await payoutService.list();
    res.json({ success: true, data });
  })
);

payoutRouter.get(
  "/:id",
  requireAuth,
  requirePermission("payouts.read"),
  asyncHandler(async function getPayout(req, res) {
    const data = await payoutService.getById(req.params.id);
    res.json({ success: true, data });
  })
);

payoutRouter.post(
  "/",
  requireAuth,
  requirePermission("payouts.write"),
  asyncHandler(async function createPayout(req, res) {
    const payload = parseBody(payoutRunSchema, req.body);
    const data = await payoutService.create(payload, req.auth.profile);
    await recordAuditLog({
      moduleName: "payouts",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

payoutRouter.post(
  "/payments",
  requireAuth,
  requirePermission("payouts.write"),
  asyncHandler(async function createPayoutPayment(req, res) {
    const payload = parseBody(payoutPaymentSchema, req.body);
    const data = await payoutService.addPayment(payload, req.auth.profile);
    await recordAuditLog({
      moduleName: "payouts",
      actionName: "payment",
      recordId: payload.payout_id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: { amount: payload.amount_paid, paymentMode: payload.payment_mode }
    });
    res.status(201).json({ success: true, data });
  })
);

payoutRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("payouts.write"),
  asyncHandler(async function deletePayout(req, res) {
    const data = await payoutService.delete(req.params.id, req.auth.profile);
    await recordAuditLog({
      moduleName: "payouts",
      actionName: "delete",
      recordId: req.params.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: {
        employeeId: data.employeeId || null
      }
    });
    res.json({ success: true, data });
  })
);
