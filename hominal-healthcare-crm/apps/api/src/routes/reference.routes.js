import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { referenceService } from "../services/reference.service.js";
import {
  doctorCreateSchema,
  doctorUpdateSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
  appSettingUpsertSchema
} from "../validators/reference.validator.js";
import { recordAuditLog } from "../lib/audit.js";

export const referenceRouter = express.Router();

referenceRouter.get(
  "/doctors",
  requireAuth,
  requirePermission("doctors.read"),
  asyncHandler(async function listDoctors(req, res) {
    const data = await referenceService.listDoctors();
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/doctors/:id",
  requireAuth,
  requirePermission("doctors.read"),
  asyncHandler(async function getDoctor(req, res) {
    const data = await referenceService.getDoctor(req.params.id);
    res.json({ success: true, data });
  })
);

referenceRouter.post(
  "/doctors",
  requireAuth,
  requirePermission("doctors.write"),
  asyncHandler(async function createDoctor(req, res) {
    const payload = parseBody(doctorCreateSchema, req.body);
    const data = await referenceService.createDoctor(payload, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "doctors",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

referenceRouter.put(
  "/doctors/:id",
  requireAuth,
  requirePermission("doctors.write"),
  asyncHandler(async function updateDoctor(req, res) {
    const payload = parseBody(doctorUpdateSchema, req.body);
    const data = await referenceService.updateDoctor(req.params.id, payload, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "doctors",
      actionName: "update",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

referenceRouter.delete(
  "/doctors/:id",
  requireAuth,
  requirePermission("doctors.write"),
  asyncHandler(async function deleteDoctor(req, res) {
    const data = await referenceService.softDeleteDoctor(req.params.id, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "doctors",
      actionName: "soft_delete",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/vendors",
  requireAuth,
  requirePermission("vendors.read"),
  asyncHandler(async function listVendors(req, res) {
    const data = await referenceService.listVendors();
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/vendors/:id",
  requireAuth,
  requirePermission("vendors.read"),
  asyncHandler(async function getVendor(req, res) {
    const data = await referenceService.getVendor(req.params.id);
    res.json({ success: true, data });
  })
);

referenceRouter.post(
  "/vendors",
  requireAuth,
  requirePermission("vendors.write"),
  asyncHandler(async function createVendor(req, res) {
    const payload = parseBody(vendorCreateSchema, req.body);
    const data = await referenceService.createVendor(payload, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "vendors",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

referenceRouter.put(
  "/vendors/:id",
  requireAuth,
  requirePermission("vendors.write"),
  asyncHandler(async function updateVendor(req, res) {
    const payload = parseBody(vendorUpdateSchema, req.body);
    const data = await referenceService.updateVendor(req.params.id, payload, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "vendors",
      actionName: "update",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

referenceRouter.delete(
  "/vendors/:id",
  requireAuth,
  requirePermission("vendors.write"),
  asyncHandler(async function deleteVendor(req, res) {
    const data = await referenceService.softDeleteVendor(req.params.id, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "vendors",
      actionName: "soft_delete",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/service-catalog",
  requireAuth,
  requirePermission("catalog.read"),
  asyncHandler(async function listCatalog(req, res) {
    const data = await referenceService.listServiceCatalog();
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/settings",
  requireAuth,
  requirePermission("settings.read"),
  asyncHandler(async function listSettings(req, res) {
    const data = await referenceService.listAppSettings();
    res.json({ success: true, data });
  })
);

referenceRouter.get(
  "/settings/:key",
  requireAuth,
  requirePermission("settings.read"),
  asyncHandler(async function getSetting(req, res) {
    const data = await referenceService.getAppSetting(req.params.key);
    res.json({ success: true, data });
  })
);

referenceRouter.put(
  "/settings",
  requireAuth,
  requirePermission("settings.write"),
  asyncHandler(async function upsertSetting(req, res) {
    const payload = parseBody(appSettingUpsertSchema, req.body);
    const data = await referenceService.upsertAppSetting(payload.key, payload.value, req.auth.profile.id);
    await recordAuditLog({
      moduleName: "settings",
      actionName: "upsert",
      recordId: null,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name,
      metadata: { key: payload.key }
    });
    res.json({ success: true, data });
  })
);
