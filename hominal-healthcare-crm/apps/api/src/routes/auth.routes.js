import express from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { parseBody } from "../validators/common.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { z } from "zod";

export const authRouter = express.Router();

const registerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "STAFF", "ACCOUNTANT", "NURSE", "ATTENDANT"]),
  mobile: z.string().optional().nullable()
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async function getMe(req, res) {
    res.json({
      success: true,
      data: Object.assign({}, req.auth.profile, {
        permissions: req.auth.permissions || []
      })
    });
  })
);

authRouter.post(
  "/register",
  requireAuth,
  requirePermission("users.write"),
  asyncHandler(async function registerUser(req, res) {
    const payload = parseBody(registerSchema, req.body);

    const authCreate = await supabaseAdmin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: payload.full_name,
        role: payload.role
      }
    });
    if (authCreate.error || !authCreate.data.user) {
      throw new HttpError(400, authCreate.error?.message || "Unable to create auth user");
    }

    const profileInsert = await supabaseAdmin
      .from("app_users")
      .insert({
        auth_user_id: authCreate.data.user.id,
        full_name: payload.full_name,
        email: payload.email,
        role: payload.role,
        mobile: payload.mobile || null
      })
      .select("*")
      .single();

    if (profileInsert.error) {
      throw new HttpError(500, profileInsert.error.message);
    }

    res.status(201).json({
      success: true,
      data: profileInsert.data
    });
  })
);
