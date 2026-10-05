import "dotenv/config";

import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function seedInitialAdmin() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error("ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD must be configured to seed the initial admin.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  }

  const passwordBytes = Buffer.byteLength(password, "utf8");
  if (password.length < 12 || passwordBytes > 72) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(742398104251::bigint)`;

    const existingAdmin = await tx.user.findFirst({
      where: { role: UserRole.ADMIN, deletedAt: null },
      select: { email: true },
    });

    if (existingAdmin) {
      if (existingAdmin.email === email) return "exists";
      throw new Error("An active admin already exists; refusing to create or promote another account.");
    }

    const existingUser = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new Error("ADMIN_EMAIL belongs to an existing non-admin account; refusing to promote it.");
    }

    const admin = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: UserRole.ADMIN,
      },
      select: { id: true, email: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        entityType: "USER",
        entityId: admin.id,
        action: "INITIAL_ADMIN_CREATED",
      },
    });

    return `created:${admin.email}`;
  });

  if (result === "exists") {
    console.info("Initial admin already exists; no changes made.");
  } else {
    console.info(`Initial ${result}.`);
  }
}

try {
  await seedInitialAdmin();
} catch (error) {
  console.error("Initial admin seeding failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
