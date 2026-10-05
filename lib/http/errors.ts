import "server-only";

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

export function toErrorResponse(error: unknown) {
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

  console.error("Unhandled API error:", error);

  return {
    body: {
      success: false,
      message: "Something went wrong",
      errors: [{ code: "INTERNAL_SERVER_ERROR" }],
    },
    status: 500,
  };
}
