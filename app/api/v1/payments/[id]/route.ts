import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getPayment } from "@/services/payment.service";
import { paymentIdSchema } from "@/validators/payment";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const id = paymentIdSchema.parse((await context.params).id);
    return successResponse("Payment fetched successfully", { payment: await getPayment(actor, id) });
  } catch (error) {
    return handleRouteError(error);
  }
}
