import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return successResponse("Profile fetched successfully", { user });
  } catch (error) {
    return handleRouteError(error);
  }
}
