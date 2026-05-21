import { z } from "zod";

export const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  conversation_id: z.string().optional(),
  scope: z.enum(["patient", "billing", "duty", "all"]).default("all"),
  context_id: z.string().optional()
});

export type AskInput = z.infer<typeof askSchema>;
