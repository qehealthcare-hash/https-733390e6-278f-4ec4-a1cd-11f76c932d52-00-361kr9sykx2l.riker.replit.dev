import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { reportService } from "../services/report.service.js";

export const reportRouter = express.Router();

reportRouter.get(
  "/patient-billing",
  requireAuth,
  requirePermission("reports.read"),
  asyncHandler(async function patientBilling(req, res) {
    res.json({ success: true, data: await reportService.patientBilling() });
  })
);

reportRouter.get(
  "/employee-payout",
  requireAuth,
  requirePermission("reports.read"),
  asyncHandler(async function employeePayout(req, res) {
    res.json({ success: true, data: await reportService.employeePayout() });
  })
);

reportRouter.get(
  "/profit-loss",
  requireAuth,
  requirePermission("reports.read"),
  asyncHandler(async function profitLoss(req, res) {
    res.json({ success: true, data: await reportService.profitLoss() });
  })
);

reportRouter.get(
  "/inquiry-conversion",
  requireAuth,
  requirePermission("reports.read"),
  asyncHandler(async function inquiryConversion(req, res) {
    res.json({ success: true, data: await reportService.inquiryConversion() });
  })
);

reportRouter.get(
  "/attendance-service",
  requireAuth,
  requirePermission("reports.read"),
  asyncHandler(async function attendanceService(req, res) {
    res.json({ success: true, data: await reportService.attendanceService() });
  })
);
