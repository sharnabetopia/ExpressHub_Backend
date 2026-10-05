import "server-only";

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/http/errors";

export function successResponse<T>(message: string, data: T, status = 200) {
  return NextResponse.json(
    { success: true, message, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function errorResponse(error: unknown) {
  const result = toErrorResponse(error);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function tooManyRequestsResponse(reset: number) {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));

  return NextResponse.json(
    {
      success: false,
      message: "Too many requests. Please try again later.",
      errors: [{ code: "RATE_LIMITED" }],
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    },
  );
}

export function validationErrorResponse(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return NextResponse.json(
    {
      success: false,
      message: "Request validation failed",
      errors: error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
