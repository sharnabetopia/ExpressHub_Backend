import { z } from "zod";

export const softDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
