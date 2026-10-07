import { PaymentStatus } from "@prisma/client";
import { z } from "zod";

export const paymentIdSchema = z.cuid();
export const initiatePaymentSchema = z.object({ shipmentId: z.cuid() }).strict();
export const paymentIdempotencySchema = z.uuid();
const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
export const listPaymentsSchema = z.object({
  page: integer(1_000_000).default(1), limit: integer(100).default(20),
  status: z.enum(PaymentStatus).optional(), shipmentId: z.cuid().optional(),
}).strict();
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;
