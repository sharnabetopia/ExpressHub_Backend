import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { uniqueQueryParameters } from "@/lib/http/query";
import { listAuditLogs } from "@/services/admin.service";
import { listAuditLogsSchema } from "@/validators/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const input = listAuditLogsSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Audit logs fetched successfully", await listAuditLogs(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
