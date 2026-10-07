import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { successResponse, tooManyRequestsResponse } from "@/lib/http/responses";
import { limitApiRequests } from "@/lib/rate-limit";
import { initiatePayment } from "@/services/payment.service";
import { initiatePaymentSchema, paymentIdempotencySchema } from "@/validators/payment";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "CUSTOMER");
    let limit;
    try { limit = await limitApiRequests(actor.id, "payments:initiate", 20); }
    catch { throw new AppError(503, "Payment initiation is temporarily unavailable", "RATE_LIMIT_UNAVAILABLE"); }
    if (!limit.success) return tooManyRequestsResponse(limit.reset);
    const key = paymentIdempotencySchema.parse(request.headers.get("idempotency-key"));
    const input = await parseRequestBody(request, initiatePaymentSchema);
    return successResponse("Payment checkout prepared", await initiatePayment(actor, input.shipmentId, key));
  } catch (error) {
    return handleRouteError(error);
  }
}
