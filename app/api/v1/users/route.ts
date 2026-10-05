import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { successResponse } from "@/lib/http/responses";
import { listUsers } from "@/services/user.service";
import { listUsersSchema } from "@/validators/user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const params = request.nextUrl.searchParams;
    for (const key of params.keys()) {
      if (params.getAll(key).length > 1) {
        throw new AppError(400, "Duplicate query parameters are not allowed", "INVALID_QUERY");
      }
    }
    const input = listUsersSchema.parse(Object.fromEntries(params));
    return successResponse("Users fetched successfully", await listUsers(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
