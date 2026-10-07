import { AppError } from "@/lib/http/errors";
import { errorResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

function notFound() {
  return errorResponse(new AppError(404, "API endpoint not found", "ENDPOINT_NOT_FOUND"));
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD, notFound as OPTIONS };
