import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { updateUserAccess } from "@/services/user.service";
import { updateStatusSchema, userIdSchema } from "@/validators/user";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const id = userIdSchema.parse((await context.params).id);
    const input = await parseRequestBody(request, updateStatusSchema);
    return successResponse("User status updated successfully", { user: await updateUserAccess(actor, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}
