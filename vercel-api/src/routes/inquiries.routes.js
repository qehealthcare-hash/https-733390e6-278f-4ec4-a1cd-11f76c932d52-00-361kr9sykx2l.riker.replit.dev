import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { inquirySchema } from "../validators/inquiry.validator.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { inquiryService } from "../services/inquiry.service.js";
import { recordAuditLog } from "../lib/audit.js";

export const inquiryRouter = express.Router();

inquiryRouter.get(
  "/",
  requireAuth,
  requirePermission("inquiries.read"),
  asyncHandler(async function listInquiries(req, res) {
    const data = await inquiryService.list(function (query) {
      return query.order("created_at", { ascending: false });
    });
    res.json({ success: true, data });
  })
);

inquiryRouter.post(
  "/",
  requireAuth,
  requirePermission("inquiries.write"),
  asyncHandler(async function createInquiry(req, res) {
    const payload = parseBody(inquirySchema, req.body);
    const data = await inquiryService.create(payload);
    await recordAuditLog({
      moduleName: "inquiries",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

inquiryRouter.put(
  "/:id",
  requireAuth,
  requirePermission("inquiries.write"),
  asyncHandler(async function updateInquiry(req, res) {
    const payload = parseBody(inquirySchema, req.body);
    const data = await inquiryService.update(req.params.id, payload);
    await recordAuditLog({
      moduleName: "inquiries",
      actionName: "update",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

inquiryRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("inquiries.write"),
  asyncHandler(async function deleteInquiry(req, res) {
    await inquiryService.remove(req.params.id);
    res.json({ success: true });
  })
);
