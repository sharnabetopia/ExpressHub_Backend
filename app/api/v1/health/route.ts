import prisma from "@/lib/prisma";
import { AppError } from "@/lib/http/errors";
import { errorResponse, successResponse } from "@/lib/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return successResponse("API is healthy", {
      status: "ok", database: "connected", timestamp: new Date().toISOString(),
    });
  } catch {
    console.error("Health check database connection failed");
    return errorResponse(new AppError(503, "Service is not ready", "DATABASE_UNAVAILABLE"));
  }
}
