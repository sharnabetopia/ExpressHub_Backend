import "server-only";

import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

import prisma from "@/lib/prisma";
import {
  assertAccessTokenConfiguration,
  createRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
  signAccessToken,
} from "@/lib/auth/tokens";
import { AppError } from "@/lib/http/errors";
import type { LoginInput, RegisterInput } from "@/validators/auth";

const PASSWORD_HASH_ROUNDS = 12;
const DUMMY_PASSWORD_HASH =
  "$2b$12$qt4m.EVm.fwF9Xr7vWqkyeHMROY.v11wqNxXSugpGmibdPsV28ol6";

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export async function registerCustomer(input: RegisterInput) {
  assertAccessTokenConfiguration();
  const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
  const refreshToken = createRefreshToken();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          phone: input.phone,
          role: UserRole.CUSTOMER,
        },
        select: safeUserSelect,
      });

      await tx.refreshToken.create({
        data: {
          userId: createdUser.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: getRefreshTokenExpiry(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: createdUser.id,
          entityType: "USER",
          entityId: createdUser.id,
          action: "USER_REGISTERED",
        },
      });

      return createdUser;
    });

    return {
      user,
      accessToken: signAccessToken({ userId: user.id, role: user.role }),
      refreshToken,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        409,
        "An account with this email already exists",
        "EMAIL_ALREADY_EXISTS",
      );
    }

    throw error;
  }
}

export async function loginUser(input: LoginInput) {
  assertAccessTokenConfiguration();

  const user = await prisma.user.findFirst({
    where: {
      email: input.email,
      isActive: true,
      deletedAt: null,
    },
    select: {
      ...safeUserSelect,
      passwordHash: true,
    },
  });

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const refreshToken = createRefreshToken();
  const accessToken = signAccessToken({ userId: user.id, role: user.role });

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: getRefreshTokenExpiry(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        action: "USER_LOGIN",
      },
    });
  });

  const { passwordHash: _passwordHash, ...safeUser } = user;

  return { user: safeUser, accessToken, refreshToken };
}

export async function rotateRefreshToken(currentToken: string) {
  assertAccessTokenConfiguration();

  const currentTokenHash = hashRefreshToken(currentToken);
  const nextRefreshToken = createRefreshToken();
  const now = new Date();

  const user = await prisma.$transaction(async (tx) => {
    const storedToken = await tx.refreshToken.findUnique({
      where: { tokenHash: currentTokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= now ||
      !storedToken.user.isActive ||
      storedToken.user.deletedAt
    ) {
      throw new AppError(
        401,
        "Invalid or expired refresh token",
        "INVALID_REFRESH_TOKEN",
      );
    }

    const revoked = await tx.refreshToken.updateMany({
      where: {
        id: storedToken.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
        lastUsedAt: now,
      },
    });

    if (revoked.count !== 1) {
      throw new AppError(
        401,
        "Invalid or expired refresh token",
        "INVALID_REFRESH_TOKEN",
      );
    }

    await tx.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        tokenHash: hashRefreshToken(nextRefreshToken),
        expiresAt: getRefreshTokenExpiry(),
      },
    });

    return storedToken.user;
  });

  return {
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
    refreshToken: nextRefreshToken,
  };
}

export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (!refreshToken) return;

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
