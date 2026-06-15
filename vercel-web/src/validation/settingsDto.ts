import { z } from "zod";

/** GET /settings — key/value map of all app settings. */
export const settingsMapDtoSchema = z.record(z.unknown());
export type SettingsMapDto = z.infer<typeof settingsMapDtoSchema>;

/** Persisted settings row returned by PUT /settings/[key]. */
export const settingsRowDtoSchema = z
  .object({
    key: z.string()
  })
  .passthrough();
export type SettingsRowDto = z.infer<typeof settingsRowDtoSchema>;

/** GET /settings/[key] — single key lookup wrapper. */
export const settingsKeyValueDtoSchema = z.object({
  key: z.string(),
  value: z.unknown().nullable()
});
export type SettingsKeyValueDto = z.infer<typeof settingsKeyValueDtoSchema>;

export const settingsDeleteResultDtoSchema = z.object({
  key: z.string(),
  deleted: z.literal(true)
});
export type SettingsDeleteResultDto = z.infer<typeof settingsDeleteResultDtoSchema>;

export const settingsBulkEntryDtoSchema = z.object({
  key: z.string(),
  value: z.unknown()
});

export const settingsBulkResultDtoSchema = z.array(settingsBulkEntryDtoSchema);
export type SettingsBulkResultDto = z.infer<typeof settingsBulkResultDtoSchema>;
