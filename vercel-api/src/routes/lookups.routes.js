import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { employeeService } from "../services/employee.service.js";
import { patientService } from "../services/patient.service.js";

export const lookupsRouter = express.Router();

lookupsRouter.get("/areas", function listAreas(req, res) {
  res.json({
    success: true,
    data: [
      "Naranpura",
      "Satellite",
      "Thaltej",
      "Bopal",
      "Vastrapur",
      "Chandkheda",
      "Maninagar",
      "Adalaj",
      "Gota",
      "Science City",
      "Kudasan",
      "Gandhinagar Sector 1-30"
    ]
  });
});

lookupsRouter.get(
  "/employees",
  requireAuth,
  requirePermission("patients.read"),
  asyncHandler(async function listEmployeeLookup(req, res) {
    const data = await employeeService.list();
    res.json({ success: true, data });
  })
);

lookupsRouter.get(
  "/patients",
  requireAuth,
  requirePermission("billings.read"),
  asyncHandler(async function listPatientLookup(req, res) {
    const data = await patientService.list();
    res.json({ success: true, data });
  })
);
