import { successResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

// A browser redirect is not evidence of payment. Settlement only uses webhooks.
export async function GET() {
  return successResponse("Checkout returned. Check your authenticated payment status for confirmation.", {
    checkout: "returned", paymentConfirmed: false,
  });
}
