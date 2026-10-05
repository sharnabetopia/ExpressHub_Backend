import type { NextRequest } from "next/server";

import {
  checkAuthRateLimit,
  clearRefreshCookie,
  ensureAllowedCookieOrigin,
  handleRouteError,
  setRefreshCookie,
} from "@/lib/auth/route-helpers";
import { refreshTokenCookie } from "@/lib/auth/tokens";
import { AppError } from "@/lib/http/errors";
import { successResponse } from "@/lib/http/responses";
import { rotateRefreshToken } from "@/services/auth.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limited = await checkAuthRateLimit(request, "auth:refresh", 30);
    if (limited) return limited;

    ensureAllowedCookieOrigin(request);
    const currentToken = request.cookies.get(refreshTokenCookie.name)?.value;

    if (!currentToken) {
      throw new AppError(401, "Refresh token is required", "MISSING_REFRESH_TOKEN");
    }

    const result = await rotateRefreshToken(currentToken);
    const response = successResponse("Token refreshed successfully", {
      accessToken: result.accessToken,
    });

    setRefreshCookie(response, result.refreshToken);
    return response;
  } catch (error) {
    const response = handleRouteError(error);

    if (error instanceof AppError && error.status === 401) {
      clearRefreshCookie(response);
    }

    return response;
  }
}
