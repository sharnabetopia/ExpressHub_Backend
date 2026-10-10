/** RentNest-style payment controller facade for ExpressHub Next.js route handlers. */
import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { uniqueQueryParameters } from "@/lib/http/query";
import { successResponse, tooManyRequestsResponse } from "@/lib/http/responses";
import { limitApiRequests } from "@/lib/rate-limit";
import { initiatePayment, listMyPayments } from "@/services/payment.service";
import {
  initiatePaymentSchema, listPaymentsSchema, paymentIdempotencySchema,
} from "@/validators/payment";

/** Create Stripe Checkout from the shipment's trusted server-side quote.
 * A stable UUID Idempotency-Key is mandatory to make retries safe.
 */
export async function createPayment(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "CUSTOMER");
    let limit;
    try {
      limit = await limitApiRequests(actor.id, "payments:initiate", 20);
    } catch {
      throw new AppError(503, "Payment initiation is temporarily unavailable", "RATE_LIMIT_UNAVAILABLE");
    }
    if (!limit.success) return tooManyRequestsResponse(limit.reset);
    const key = paymentIdempotencySchema.parse(request.headers.get("idempotency-key"));
    const input = await parseRequestBody(request, initiatePaymentSchema);
    return successResponse("Payment checkout prepared", await initiatePayment(actor, input.shipmentId, key));
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Tenant-style authenticated payment history, filtered to the caller. */
export async function getUserPaymentHistory(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const input = listPaymentsSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Payments fetched successfully", await listMyPayments(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
