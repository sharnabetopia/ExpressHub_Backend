import { AuditEntityType } from "@prisma/client";
import { z } from "zod";
import { paginationFields, sortOrder, dateRangeFields, validDateRange, dateRangeError } from "@/validators/list-query";

export const dashboardQuerySchema = z.object({}).strict();
export const listAuditLogsSchema = z.object({
  ...paginationFields,
  actorId: z.cuid().optional(), entityType: z.enum(AuditEntityType).optional(),
  entityId: z.cuid().optional(), shipmentId: z.cuid().optional(), paymentId: z.cuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  ...dateRangeFields,
  sortBy: z.enum(["createdAt", "action"]).default("createdAt"),
  order: sortOrder,
}).strict().refine(validDateRange, dateRangeError);
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
