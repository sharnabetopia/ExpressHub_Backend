import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/http/errors";
import { errorResponse } from "@/lib/http/responses";

const allowedMethods = "GET, POST, PATCH, DELETE, OPTIONS";
const allowedHeaders = "Authorization, Content-Type, X-CSRF-Token, Idempotency-Key";

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigin = process.env.ALLOWED_ORIGIN;

  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigin || origin !== allowedOrigin) {
      return errorResponse(new AppError(403, "Request origin is not allowed", "ORIGIN_NOT_ALLOWED"));
    }

    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": allowedMethods,
        "Access-Control-Allow-Headers": allowedHeaders,
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }

  const response = NextResponse.next();

  if (origin && allowedOrigin && origin === allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", allowedMethods);
    response.headers.set("Access-Control-Allow-Headers", allowedHeaders);
    response.headers.set("Vary", "Origin");
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
