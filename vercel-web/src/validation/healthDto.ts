import { z } from "zod";

export const healthSnapshotDtoSchema = z.object({
  service: z.string(),
  version: z.number(),
  time: z.string(),
  deps: z.object({
    supabase: z.object({
      ok: z.boolean(),
      error: z.string().nullable()
    }),
    openai: z.boolean(),
    whatsapp: z.boolean()
  }),
  monitoring: z.object({
    sentry: z.boolean()
  })
});
export type HealthSnapshotDto = z.infer<typeof healthSnapshotDtoSchema>;
