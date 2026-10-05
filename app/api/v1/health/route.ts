import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      success: true,
      message: "API is healthy",
      data: {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Health check database connection failed:", errorName);

    return NextResponse.json(
      {
        success: false,
        message: "Service is not ready",
        errors: [{ code: "DATABASE_UNAVAILABLE" }],
      },
      { status: 503 },
    );
  }
}
