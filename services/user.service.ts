import "server-only";

import { Prisma, UserRole } from "@prisma/client";
import { requireRole, type AuthenticatedUser } from "@/lib/auth/require-user";
import { AppError } from "@/lib/http/errors";
import prisma from "@/lib/prisma";
import type { ListUsersInput, UpdateProfileInput } from "@/validators/user";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const notFound = () => new AppError(404, "User not found", "USER_NOT_FOUND");

// Retry serialization conflicts so concurrent role changes cannot use stale authority.
async function mutateUser<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2034") {
          if (attempt < 2) continue;
          throw new AppError(
            409,
            "User changed concurrently; please retry",
            "USER_CONFLICT",
          );
        }
        if (error.code === "P2002") {
          throw new AppError(
            409,
            "An account with this email already exists",
            "EMAIL_ALREADY_EXISTS",
          );
        }
      }
      throw error;
    }
  }
  throw new Error("Unreachable transaction retry state");
}

async function activeActor(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  admin = false,
) {
  const current = await tx.user.findFirst({
    where: { id: actor.id, isActive: true, deletedAt: null },
    select: profileSelect,
  });
  if (!current)
    throw new AppError(401, "Authentication required", "UNAUTHENTICATED");
  if (admin) requireRole(current, UserRole.ADMIN);
  return current;
}

export async function getUserProfile(actor: AuthenticatedUser, id: string) {
  if (actor.id !== id && actor.role !== UserRole.ADMIN) throw notFound();
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: profileSelect,
  });
  if (!user) throw notFound();
  return user;
}

export async function updateProfile(
  actor: AuthenticatedUser,
  input: UpdateProfileInput,
) {
  return mutateUser(async (tx) => {
    const before = await activeActor(tx, actor);
    const user = await tx.user.update({
      where: { id: actor.id },
      data: input,
      select: profileSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        entityType: "USER",
        entityId: actor.id,
        action: "USER_PROFILE_UPDATED",
        details: {
          before: {
            name: before.name,
            email: before.email,
            phone: before.phone,
          },
          after: { name: user.name, email: user.email, phone: user.phone },
        },
      },
    });
    return user;
  });
}

export async function listUsers(
  actor: AuthenticatedUser,
  input: ListUsersInput,
) {
  requireRole(actor, UserRole.ADMIN);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    role: input.role,
    isActive: input.isActive,
    ...(input.q
      ? {
          OR: ["name", "email", "phone"].map((field) => ({
            [field]: { contains: input.q, mode: "insensitive" },
          })),
        }
      : {}),
  };
  const [users, total] = await prisma.$transaction(
    [
      prisma.user.findMany({
        where,
        select: profileSelect,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ [input.sortBy]: input.order }, { id: "asc" }],
      }),
      prisma.user.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    users,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}

export async function updateUserAccess(
  actor: AuthenticatedUser,
  id: string,
  change: { role: UserRole } | { isActive: boolean },
) {
  requireRole(actor, UserRole.ADMIN);
  return mutateUser(async (tx) => {
    await activeActor(tx, actor, true);
    const before = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: profileSelect,
    });
    if (!before) throw notFound();
    const roleChange = "role" in change;
    const changed = roleChange
      ? before.role !== change.role
      : before.isActive !== change.isActive;
    if (!changed) return before;
    // An Admin must retain their own access; another active Admin can manage it.
    if (id === actor.id) {
      throw new AppError(
        409,
        "An Admin cannot change their own role or active status",
        "SELF_ACCESS_CHANGE",
      );
    }
    const user = await tx.user.update({
      where: { id },
      data: change,
      select: profileSelect,
    });
    if (roleChange || !user.isActive) {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        entityType: "USER",
        entityId: id,
        action: roleChange ? "USER_ROLE_UPDATED" : "USER_STATUS_UPDATED",
        details: {
          before: { role: before.role, isActive: before.isActive },
          after: { role: user.role, isActive: user.isActive },
        },
      },
    });
    return user;
  });
}

export async function softDeleteUser(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
) {
  requireRole(actor, "ADMIN");
  return mutateUser(async (tx) => {
    await activeActor(tx, actor, true);
    const before = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: profileSelect,
    });
    if (!before) throw notFound();
    if (id === actor.id)
      throw new AppError(
        409,
        "An Admin cannot delete their own account",
        "SELF_ACCESS_CHANGE",
      );
    const activeShipment = await tx.shipment.findFirst({
      where: {
        deletedAt: null,
        status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] },
        OR: [{ customerId: id }, { courierId: id }],
      },
      select: { id: true },
    });
    if (activeShipment)
      throw new AppError(
        409,
        "Resolve active shipments before deleting this user",
        "USER_CONFLICT",
      );
    const unresolvedPayment = await tx.payment.findFirst({
      where: {
        payerId: id,
        status: { in: ["PENDING", "REFUND_PENDING"] },
      },
      select: { id: true },
    });
    if (unresolvedPayment)
      throw new AppError(
        409,
        "Resolve pending payments or refunds before deleting this user",
        "USER_CONFLICT",
      );
    const deletedAt = new Date();
    await tx.user.update({
      where: { id },
      data: { deletedAt, isActive: false },
    });
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: deletedAt },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        entityType: "USER",
        entityId: id,
        action: "USER_SOFT_DELETED",
        details: {
          reason,
          before: { isActive: before.isActive, deletedAt: null },
          after: { isActive: false, deletedAt: deletedAt.toISOString() },
        },
      },
    });
    return { id, deletedAt };
  });
}
