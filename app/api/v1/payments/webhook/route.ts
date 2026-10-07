import { createHash } from "node:crypto";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { readWebhookBody, verifyStripeEvent } from "@/lib/payments/stripe";
import { processStripeEvent } from "@/services/payment.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await readWebhookBody(request);
    const event = verifyStripeEvent(raw, request.headers.get("stripe-signature"));
    const result = await processStripeEvent(event, createHash("sha256").update(raw).digest("hex"));
    return successResponse("Webhook received", result);
  } catch (error) {
    return handleRouteError(error);
  }
}
