import { AuditEntityType } from "@prisma/client";
import { z } from "zod";

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
export const dashboardQuerySchema = z.object({}).strict();
export const listAuditLogsSchema = z.object({
  page: integer(1_000_000).default(1), limit: integer(100).default(20),
  actorId: z.cuid().optional(), entityType: z.enum(AuditEntityType).optional(),
  entityId: z.cuid().optional(), shipmentId: z.cuid().optional(), paymentId: z.cuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  sortBy: z.enum(["createdAt", "action"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: "from must be no later than to", path: ["from"],
});
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
