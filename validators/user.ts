import { UserRole } from "@prisma/client";
import { z } from "zod";

export const userIdSchema = z.cuid();

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
  phone: z.string().trim().min(5).max(30).nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "Provide at least one profile field",
});

export const updateRoleSchema = z.object({ role: z.enum(UserRole) }).strict();
export const updateStatusSchema = z.object({ isActive: z.boolean() }).strict();

const positiveInteger = (maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().max(maximum));

export const listUsersSchema = z.object({
  page: positiveInteger(1_000_000).default(1),
  limit: positiveInteger(100).default(20),
  role: z.enum(UserRole).optional(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
