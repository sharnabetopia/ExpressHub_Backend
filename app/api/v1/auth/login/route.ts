import type { NextRequest } from "next/server";

import {
  checkAuthRateLimit,
  ensureAllowedCookieOrigin,
  handleRouteError,
  parseRequestBody,
  setRefreshCookie,
} from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { loginUser } from "@/services/auth.service";
import { loginSchema } from "@/validators/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limited = await checkAuthRateLimit(request, "auth:login", 10);
    if (limited) return limited;

    ensureAllowedCookieOrigin(request);
    const input = await parseRequestBody(request, loginSchema);
    const result = await loginUser(input);
    const response = successResponse("Login successful", {
      user: result.user,
      accessToken: result.accessToken,
    });

    setRefreshCookie(response, result.refreshToken);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
