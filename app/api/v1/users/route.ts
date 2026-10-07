import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { uniqueQueryParameters } from "@/lib/http/query";
import { successResponse } from "@/lib/http/responses";
import { listUsers } from "@/services/user.service";
import { listUsersSchema } from "@/validators/user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const input = listUsersSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Users fetched successfully", await listUsers(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
