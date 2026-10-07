import { UserRole } from "@prisma/client";
import { z } from "zod";
import { paginationFields, searchQuery, sortOrder } from "@/validators/list-query";

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

export const listUsersSchema = z.object({
  ...paginationFields,
  role: z.enum(UserRole).optional(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  q: searchQuery,
  sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
  order: sortOrder,
}).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
