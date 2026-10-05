import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getUserProfile } from "@/services/user.service";
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
