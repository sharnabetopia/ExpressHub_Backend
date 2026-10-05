import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes",
  });

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
    phone: z.string().trim().min(5).max(30).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1)
      .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
        message: "Password must be no more than 72 UTF-8 bytes",
      }),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
