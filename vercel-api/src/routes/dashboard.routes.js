import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { dashboardService } from "../services/dashboard.service.js";

export const dashboardRouter = express.Router();

dashboardRouter.get(
  "/summary",
  requireAuth,
  requirePermission("dashboard.read"),
  asyncHandler(async function getSummary(req, res) {
    const data = await dashboardService.summary();
    res.json({ success: true, data });
  })
);
