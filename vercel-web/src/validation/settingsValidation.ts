import { z } from "zod";

export const settingsKeySchema = z
  .string()
  .trim()
  .min(1, "key is required")
  .max(120);

export const settingsBulkSchema = z.record(z.unknown()).refine(
  (obj) => Object.keys(obj).length > 0,
  { message: "At least one key/value is required" }
);

export type SettingsBulkInput = z.infer<typeof settingsBulkSchema>;
