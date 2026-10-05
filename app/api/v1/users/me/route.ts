import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getUserProfile, updateProfile } from "@/services/user.service";
import { updateProfileSchema } from "@/validators/user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const user = await getUserProfile(actor, actor.id);
    return successResponse("Profile fetched successfully", { user });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const input = await parseRequestBody(request, updateProfileSchema);
    const user = await updateProfile(actor, input);
    return successResponse("Profile updated successfully", { user });
  } catch (error) {
    return handleRouteError(error);
  }
}
