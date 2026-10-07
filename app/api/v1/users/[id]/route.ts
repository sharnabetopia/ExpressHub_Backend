import { softDeleteSchema } from "@/validators/soft-delete";
import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getUserProfile, softDeleteUser } from "@/services/user.service";
import { userIdSchema } from "@/validators/user";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const id = userIdSchema.parse((await context.params).id);
    return successResponse("User fetched successfully", { user: await getUserProfile(actor, id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const id = userIdSchema.parse((await context.params).id);
    const { reason } = await parseRequestBody(request, softDeleteSchema);
    return successResponse("User deleted successfully", { user: await softDeleteUser(actor, id, reason) });
  } catch (error) {
    return handleRouteError(error);
  }
}
