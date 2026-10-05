import type { NextRequest } from "next/server";

import { registerCustomer } from "@/services/auth.service";
import {
  checkAuthRateLimit,
  ensureAllowedCookieOrigin,
  handleRouteError,
  parseRequestBody,
  setRefreshCookie,
} from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { registerSchema } from "@/validators/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limited = await checkAuthRateLimit(request, "auth:register", 5);
    if (limited) return limited;

    ensureAllowedCookieOrigin(request);
    const input = await parseRequestBody(request, registerSchema);
    const result = await registerCustomer(input);
    const response = successResponse(
      "Account created successfully",
      { user: result.user, accessToken: result.accessToken },
      201,
    );

    setRefreshCookie(response, result.refreshToken);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
