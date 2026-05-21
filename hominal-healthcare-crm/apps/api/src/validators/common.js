import { z } from "zod";

export const phoneSchema = z
  .string()
  .min(10)
  .max(15)
  .regex(/^[0-9+]+$/, "Phone must contain only digits or +");

export const paginationSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20)
});

export function parseBody(schema, payload) {
  return schema.parse(payload);
}
