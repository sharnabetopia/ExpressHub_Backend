import { PaymentStatus, ShipmentStatus } from "@prisma/client";
import { z } from "zod";

export const shipmentIdSchema = z.cuid();
const dimension = z.number().positive().max(99999999.99).multipleOf(0.01);
export const createShipmentSchema = z.object({
  pickupContactName: z.string().trim().min(2).max(100),
  pickupContactPhone: z.string().trim().min(5).max(30),
  pickupAddress: z.string().trim().min(5).max(500),
  deliveryContactName: z.string().trim().min(2).max(100),
  deliveryContactPhone: z.string().trim().min(5).max(30),
  deliveryAddress: z.string().trim().min(5).max(500),
  packageDescription: z.string().trim().min(1).max(1000).optional(),
  parcelWeightKg: z.number().positive().max(9999999.999).multipleOf(0.001),
  parcelLengthCm: dimension.optional(),
  parcelWidthCm: dimension.optional(),
  parcelHeightCm: dimension.optional(),
  pickupScheduledAt: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now(), {
    message: "Pickup must be scheduled in the future",
  }).optional(),
}).strict().refine((input) => {
  const count = [input.parcelLengthCm, input.parcelWidthCm, input.parcelHeightCm].filter((v) => v !== undefined).length;
  return count === 0 || count === 3;
}, { message: "Provide all three parcel dimensions or omit them" });

export const assignCourierSchema = z.object({
  courierId: z.cuid(),
  expectedCourierId: z.cuid().nullable(),
}).strict();

export const shipmentStatusSchema = z.object({
  status: z.enum(ShipmentStatus),
  expectedStatus: z.enum(ShipmentStatus),
  note: z.string().trim().min(3).max(1000).optional(),
}).strict().refine((input) => !["DELIVERED", "FAILED", "RETURNED"].includes(input.status) || Boolean(input.note), {
  message: "Delivery confirmation or failure/return reason is required", path: ["note"],
});

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
export const listShipmentsSchema = z.object({
  page: integer(1_000_000).default(1), limit: integer(100).default(20),
  status: z.enum(ShipmentStatus).optional(), paymentStatus: z.enum(PaymentStatus).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "price"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict().refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), {
  message: "from must be no later than to", path: ["from"],
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type AssignCourierInput = z.infer<typeof assignCourierSchema>;
export type ShipmentStatusInput = z.infer<typeof shipmentStatusSchema>;
export type ListShipmentsInput = z.infer<typeof listShipmentsSchema>;
