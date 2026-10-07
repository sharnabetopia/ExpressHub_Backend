import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { successResponse } from "@/lib/http/responses";
import { listMyPayments } from "@/services/payment.service";
import { listPaymentsSchema } from "@/validators/payment";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const params = request.nextUrl.searchParams;
    for (const key of params.keys()) {
      if (params.getAll(key).length > 1) throw new AppError(400, "Duplicate query parameters are not allowed", "INVALID_QUERY");
    }
    const input = listPaymentsSchema.parse(Object.fromEntries(params));
    return successResponse("Payments fetched successfully", await listMyPayments(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
