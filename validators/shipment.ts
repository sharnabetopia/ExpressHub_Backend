import { PaymentStatus, ShipmentStatus } from "@prisma/client";
import { z } from "zod";
import { paginationFields, searchQuery, sortOrder, dateRangeFields, validDateRange, dateRangeError } from "@/validators/list-query";

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

export const listShipmentsSchema = z.object({
  ...paginationFields,
  status: z.enum(ShipmentStatus).optional(), paymentStatus: z.enum(PaymentStatus).optional(),
  q: searchQuery,
  ...dateRangeFields,
  sortBy: z.enum(["createdAt", "updatedAt", "price"]).default("createdAt"),
  order: sortOrder,
}).strict().refine(validDateRange, dateRangeError);

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type AssignCourierInput = z.infer<typeof assignCourierSchema>;
export type ShipmentStatusInput = z.infer<typeof shipmentStatusSchema>;
export type ListShipmentsInput = z.infer<typeof listShipmentsSchema>;
