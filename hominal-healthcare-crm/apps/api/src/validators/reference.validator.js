import { z } from "zod";

export const doctorCreateSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  specialization: z.string().optional().default(""),
  mobile: z.string().optional().default(""),
  email: z.string().optional().default(""),
  address: z.string().optional().default(""),
  active: z.boolean().optional().default(true)
});

export const doctorUpdateSchema = doctorCreateSchema.partial();

export const vendorCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact_name: z.string().optional().default(""),
  mobile: z.string().optional().default(""),
  email: z.string().optional().default(""),
  gst: z.string().optional().default(""),
  pan: z.string().optional().default(""),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  active: z.boolean().optional().default(true)
});

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const appSettingUpsertSchema = z.object({
  key: z.string().min(1),
  value: z.any()
});
