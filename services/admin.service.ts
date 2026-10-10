import "server-only";
import {
  Prisma,
  PaymentStatus,
  ShipmentStatus,
  UserRole,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireRole, type AuthenticatedUser } from "@/lib/auth/require-user";
import type { ListAuditLogsInput } from "@/validators/admin";

function zeroCounts<T extends string>(values: T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<
    T,
    number
  >;
}

export async function getDashboardStats(actor: AuthenticatedUser) {
  requireRole(actor, "ADMIN");
  // All aggregates share one database snapshot. Retained payment history includes
  // deleted shipments, while operational user/shipment counts exclude deletion.
  const [userGroups, shipmentGroups, paymentGroups] = await prisma.$transaction(
    [
      prisma.user.groupBy({
        by: ["role", "isActive"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.shipment.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ["currency", "status"],
        _count: { _all: true },
        _sum: { amount: true },
        orderBy: [{ currency: "asc" }, { status: "asc" }],
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const users = {
    total: 0,
    active: 0,
    inactive: 0,
    byRole: zeroCounts(Object.values(UserRole)),
  };
  for (const group of userGroups) {
    users.total += group._count._all;
    users[group.isActive ? "active" : "inactive"] += group._count._all;
    users.byRole[group.role] += group._count._all;
  }
  const shipments = {
    total: 0,
    active: 0,
    byStatus: zeroCounts(Object.values(ShipmentStatus)),
  };
  for (const group of shipmentGroups) {
    shipments.total += group._count._all;
    shipments.byStatus[group.status] += group._count._all;
    if (!["DELIVERED", "RETURNED", "CANCELLED"].includes(group.status))
      shipments.active += group._count._all;
  }
  const payments = {
    total: 0,
    byStatus: zeroCounts(Object.values(PaymentStatus)),
    amounts: paymentGroups.map((group) => ({
      currency: group.currency,
      status: group.status,
      count: group._count._all,
      amount: (group._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    })),
  };
  for (const group of paymentGroups) {
    payments.total += group._count._all;
    payments.byStatus[group.status] += group._count._all;
  }
  return { users, shipments, payments };
}

export async function listAuditLogs(
  actor: AuthenticatedUser,
  input: ListAuditLogsInput,
) {
  requireRole(actor, "ADMIN");
  const where: Prisma.AuditLogWhereInput = {
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    shipmentId: input.shipmentId,
    paymentId: input.paymentId,
    action: input.action,
    createdAt: {
      gte: input.from ? new Date(input.from) : undefined,
      lte: input.to ? new Date(input.to) : undefined,
    },
  };
  const [auditLogs, total] = await prisma.$transaction(
    [
      prisma.auditLog.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ [input.sortBy]: input.order }, { id: "asc" }],
        // Do not join entire users/payments: they contain passwords and provider data.
        select: {
          id: true,
          actorId: true,
          entityType: true,
          entityId: true,
          shipmentId: true,
          paymentId: true,
          action: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    auditLogs,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}
