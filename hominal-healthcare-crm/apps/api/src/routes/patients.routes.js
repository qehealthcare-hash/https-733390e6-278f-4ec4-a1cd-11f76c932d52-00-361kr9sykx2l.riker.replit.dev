import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { patientSchema } from "../validators/patient.validator.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { patientService } from "../services/patient.service.js";
import { recordAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";

export const patientRouter = express.Router();

patientRouter.get(
  "/",
  requireAuth,
  requirePermission("patients.read"),
  asyncHandler(async function listPatients(req, res) {
    const data = await patientService.list();
    res.json({ success: true, data });
  })
);

patientRouter.get(
  "/:id",
  requireAuth,
  requirePermission("patients.read"),
  asyncHandler(async function getPatient(req, res) {
    const data = await patientService.getById(req.params.id);
    res.json({ success: true, data });
  })
);

patientRouter.post(
  "/",
  requireAuth,
  requirePermission("patients.write"),
  asyncHandler(async function createPatient(req, res) {
    const payload = parseBody(patientSchema, req.body);
    if (payload.status === "CLOSED" && !payload.close_reason) {
      throw new HttpError(400, "Closing reason is required when status is Closed");
    }
    const data = await patientService.create({
      full_name: payload.full_name,
      age: payload.age,
      gender: payload.gender,
      address: payload.address,
      area: payload.area,
      city: payload.city,
      pincode: payload.pincode,
      mobile: payload.mobile,
      disease_condition: payload.disease_condition,
      assigned_staff_id: payload.assigned_staff_id || null,
      shift_type: payload.shift_type,
      start_date: payload.start_date,
      status: payload.status,
      close_reason: payload.close_reason || null,
      relative_contacts: payload.relative_contacts
    });
    await patientService.replaceDocuments(data.id, payload.documents || []);
    const fresh = await patientService.getById(data.id);
    await recordAuditLog({
      moduleName: "patients",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data: fresh });
  })
);

patientRouter.put(
  "/:id",
  requireAuth,
  requirePermission("patients.write"),
  asyncHandler(async function updatePatient(req, res) {
    const payload = parseBody(patientSchema, req.body);
    if (payload.status === "CLOSED" && !payload.close_reason) {
      throw new HttpError(400, "Closing reason is required when status is Closed");
    }
    const data = await patientService.update(req.params.id, {
      full_name: payload.full_name,
      age: payload.age,
      gender: payload.gender,
      address: payload.address,
      area: payload.area,
      city: payload.city,
      pincode: payload.pincode,
      mobile: payload.mobile,
      disease_condition: payload.disease_condition,
      assigned_staff_id: payload.assigned_staff_id || null,
      shift_type: payload.shift_type,
      start_date: payload.start_date,
      status: payload.status,
      close_reason: payload.close_reason || null,
      relative_contacts: payload.relative_contacts
    });
    await patientService.replaceDocuments(req.params.id, payload.documents || []);
    const fresh = await patientService.getById(req.params.id);
    await recordAuditLog({
      moduleName: "patients",
      actionName: "update",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data: fresh });
  })
);

patientRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("patients.write"),
  asyncHandler(async function deletePatient(req, res) {
    await patientService.remove(req.params.id);
    res.json({ success: true });
  })
);
