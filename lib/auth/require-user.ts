import "server-only";

import { UserRole } from "@prisma/client";

import prisma from "@/lib/prisma";
import { assertAccessTokenConfiguration, verifyAccessToken } from "@/lib/auth/tokens";
import { AppError } from "@/lib/http/errors";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new AppError(401, "Authentication required", "UNAUTHENTICATED");
  }

  assertAccessTokenConfiguration();
  let claims;

  try {
    claims = verifyAccessToken(match[1]);
  } catch {
    throw new AppError(401, "Invalid or expired access token", "INVALID_TOKEN");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: claims.userId,
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  if (!user) {
    throw new AppError(401, "Invalid or expired access token", "INVALID_TOKEN");
  }

  return user;
}

export function requireRole(user: AuthenticatedUser, ...allowedRoles: UserRole[]) {
  if (!allowedRoles.includes(user.role)) {
    throw new AppError(403, "You do not have permission to perform this action", "FORBIDDEN");
  }

  return user;
}
