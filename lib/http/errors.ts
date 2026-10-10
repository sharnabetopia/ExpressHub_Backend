import "server-only";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly reset: number) {
    super(429, "Too many requests. Please try again later.", "RATE_LIMITED");
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        success: false,
        message: "Request validation failed",
        errors: error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
      },
    };
  }
  if (error instanceof AppError) {
    return {
      body: {
        success: false,
        message: error.message,
        errors: error.details ?? [{ code: error.code }],
      },
      status: error.status,
    };
  }

  // Unexpected exceptions may contain SQL, credentials or provider payloads.
  console.error("Unhandled API error");

  return {
    body: {
      success: false,
      message: "Something went wrong",
      errors: [{ code: "INTERNAL_SERVER_ERROR" }],
    },
    status: 500,
  };
}
