import type { NextRequest } from "next/server";

import {
  checkAuthRateLimit,
  clearRefreshCookie,
  ensureAllowedCookieOrigin,
  handleRouteError,
} from "@/lib/auth/route-helpers";
import { refreshTokenCookie } from "@/lib/auth/tokens";
import { successResponse } from "@/lib/http/responses";
import { revokeRefreshToken } from "@/services/auth.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limited = await checkAuthRateLimit(request, "auth:logout", 30);
    if (limited) return limited;

    ensureAllowedCookieOrigin(request);
    const refreshToken = request.cookies.get(refreshTokenCookie.name)?.value;
    await revokeRefreshToken(refreshToken);

    const response = successResponse("Logged out successfully", null);
    clearRefreshCookie(response);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
