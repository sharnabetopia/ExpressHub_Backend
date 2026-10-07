import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { uniqueQueryParameters } from "@/lib/http/query";
import { getDashboardStats } from "@/services/admin.service";
import { dashboardQuerySchema } from "@/validators/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    dashboardQuerySchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Dashboard statistics fetched successfully", await getDashboardStats(actor));
  } catch (error) {
    return handleRouteError(error);
  }
}
