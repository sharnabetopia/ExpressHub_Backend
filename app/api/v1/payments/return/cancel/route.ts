import { successResponse } from "@/lib/http/responses";

export const runtime = "nodejs";

// Leaving Checkout does not expire the session or cancel the shipment.
export async function GET() {
  return successResponse("Checkout was left without confirmation. The payment session may still be open.", {
    checkout: "cancelled", paymentConfirmed: false,
  });
}
