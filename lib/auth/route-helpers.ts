import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

import { isAllowedCookieRequest, refreshTokenCookie } from "@/lib/auth/tokens";
import { AppError } from "@/lib/http/errors";
import { errorResponse, tooManyRequestsResponse, validationErrorResponse } from "@/lib/http/responses";
import { getRateLimitIdentifier, limitApiRequests } from "@/lib/rate-limit";

export async function parseRequestBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new AppError(415, "Content-Type must be application/json", "UNSUPPORTED_MEDIA_TYPE");
  }

  const maxBodyBytes = 16 * 1024;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new AppError(413, "Request body is too large", "REQUEST_TOO_LARGE");
  }

  if (!request.body) {
    throw new AppError(400, "Request body must be valid JSON", "INVALID_JSON");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      await reader.cancel();
      throw new AppError(413, "Request body is too large", "REQUEST_TOO_LARGE");
    }

    chunks.push(value);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  } catch {
    throw new AppError(400, "Request body must be valid JSON", "INVALID_JSON");
  }

  return schema.parse(body);
}

export async function checkAuthRateLimit(
  request: NextRequest,
  scope: string,
  limit: number,
) {
  let result;
  try {
    result = await limitApiRequests(
      getRateLimitIdentifier(request),
      scope,
      limit,
      15 * 60 * 1000,
    );
  } catch (error) {
    console.error("Authentication rate limit check failed:", error);
    throw new AppError(503, "Authentication service is temporarily unavailable", "RATE_LIMIT_UNAVAILABLE");
  }

  return result.success ? null : tooManyRequestsResponse(result.reset);
}

export function ensureAllowedCookieOrigin(request: Request) {
  if (!isAllowedCookieRequest(request)) {
    throw new AppError(403, "Request origin is not allowed", "ORIGIN_NOT_ALLOWED");
  }
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return validationErrorResponse(error);
  }

  return errorResponse(error);
}

export function setRefreshCookie(
  response: NextResponse,
  token: string,
) {
  response.cookies.set({
    ...refreshTokenCookie,
    value: token,
  });
}

export function clearRefreshCookie(response: NextResponse) {
  response.cookies.set({
    ...refreshTokenCookie,
    value: "",
    maxAge: 0,
  });
}
