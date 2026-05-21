import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { employeeSchema } from "../validators/employee.validator.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { employeeService } from "../services/employee.service.js";
import { recordAuditLog } from "../lib/audit.js";

export const employeeRouter = express.Router();

employeeRouter.get(
  "/",
  requireAuth,
  requirePermission("employees.read"),
  asyncHandler(async function listEmployees(req, res) {
    const data = await employeeService.list(function (query) {
      return query.order("created_at", { ascending: false });
    });
    res.json({ success: true, data });
  })
);

employeeRouter.get(
  "/:id",
  requireAuth,
  requirePermission("employees.read"),
  asyncHandler(async function getEmployee(req, res) {
    const data = await employeeService.getById(req.params.id);
    res.json({ success: true, data });
  })
);

employeeRouter.post(
  "/",
  requireAuth,
  requirePermission("employees.write"),
  asyncHandler(async function createEmployee(req, res) {
    const payload = parseBody(employeeSchema, req.body);
    const data = await employeeService.create({
      full_name: payload.full_name,
      mobile: payload.mobile,
      address: payload.address,
      role: payload.role,
      education: payload.education,
      shift_type: payload.shift_type,
      active: payload.active
    });
    await employeeService.replaceDocuments(data.id, payload.documents);
    await recordAuditLog({
      moduleName: "employees",
      actionName: "create",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.status(201).json({ success: true, data });
  })
);

employeeRouter.put(
  "/:id",
  requireAuth,
  requirePermission("employees.write"),
  asyncHandler(async function updateEmployee(req, res) {
    const payload = parseBody(employeeSchema, req.body);
    const data = await employeeService.update(req.params.id, {
      full_name: payload.full_name,
      mobile: payload.mobile,
      address: payload.address,
      role: payload.role,
      education: payload.education,
      shift_type: payload.shift_type,
      active: payload.active
    });
    await employeeService.replaceDocuments(req.params.id, payload.documents);
    await recordAuditLog({
      moduleName: "employees",
      actionName: "update",
      recordId: data.id,
      actorUserId: req.auth.profile.id,
      actorName: req.auth.profile.full_name
    });
    res.json({ success: true, data });
  })
);

employeeRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("employees.write"),
  asyncHandler(async function deleteEmployee(req, res) {
    await employeeService.remove(req.params.id);
    res.json({ success: true });
  })
);
