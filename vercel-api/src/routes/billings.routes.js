import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { invoiceSchema, receiptSchema } from "../validators/billing.validator.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { billingService } from "../services/billing.service.js";
import { recordAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";

export const billingRouter = express.Router();

billingRouter.get(
  "/",
  requireAuth,
  requirePermission("billings.read"),
  asyncHandler(async function listInvoices(req, res) {
    const data = await billingService.list();
    res.json({ success: true, data });
  })
);

billingRouter.get(
  "/:id",
  requireAuth,
  requirePermission("billings.read"),
  asyncHandler(async function getInvoice(req, res) {
    const data = await billingService.getById(req.params.id);
    res.json({ success: true, data });
  })
);

billingRouter.post(
  "/",
  requireAuth,
  requirePermission("billings.write"),
  asyncHandler(async function createInvoice(req, res) {
    const payload = parseBody(invoiceSchema, req.body);
    const data = await billingService.create(payload, req.auth.profile);
    await recordAuditLog({
      moduleName: "billings",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

billingRouter.patch(
  "/:id/status",
  requireAuth,
  requirePermission("billings.write"),
  asyncHandler(async function updateInvoiceStatus(req, res) {
    const status = req.body.status;
    const closeReason = req.body.close_reason || null;
    if (status === "CLOSED" && !closeReason) {
      throw new HttpError(400, "Closing reason is required");
    }
    const data = await billingService.updateStatus(req.params.id, status, closeReason, req.auth.profile);
    await recordAuditLog({
      moduleName: "billings",
      actionName: "status_change",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: { status, closeReason }
    });
    res.json({ success: true, data });
  })
);

billingRouter.post(
  "/receipts",
  requireAuth,
  requirePermission("billings.write"),
  asyncHandler(async function createReceipt(req, res) {
    const payload = parseBody(receiptSchema, req.body);
    const data = await billingService.addReceipt(payload, req.auth.profile);
    await recordAuditLog({
      moduleName: "receipts",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

billingRouter.post(
  "/receipts/:id/restore",
  requireAuth,
  requirePermission("billings.write"),
  asyncHandler(async function restoreReceipt(req, res) {
    const data = await billingService.restoreReceipt(req.params.id, req.auth.profile);
    await recordAuditLog({
      moduleName: "receipts",
      actionName: "restore",
      recordId: req.params.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: { invoiceId: data.invoice ? data.invoice.id : null }
    });
    res.json({ success: true, data });
  })
);

billingRouter.delete(
  "/receipts/:id",
  requireAuth,
  requirePermission("billings.write"),
  asyncHandler(async function deleteReceipt(req, res) {
    const data = await billingService.deleteReceipt(req.params.id, req.auth.profile);
    await recordAuditLog({
      moduleName: "receipts",
      actionName: "delete",
      recordId: req.params.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: {
        invoiceId: data.invoice ? data.invoice.id : data.invoice_id || null
      }
    });
    res.json({ success: true, data });
  })
);
