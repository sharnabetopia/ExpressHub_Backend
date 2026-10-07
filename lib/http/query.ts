import "server-only";
import { AppError } from "@/lib/http/errors";

export function uniqueQueryParameters(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (params.getAll(key).length > 1) {
      throw new AppError(400, "Duplicate query parameters are not allowed", "INVALID_QUERY");
    }
  }
  return Object.fromEntries(params);
}
