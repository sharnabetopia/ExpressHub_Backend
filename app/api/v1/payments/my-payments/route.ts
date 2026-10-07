import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { uniqueQueryParameters } from "@/lib/http/query";
import { successResponse } from "@/lib/http/responses";
import { listMyPayments } from "@/services/payment.service";
import { listPaymentsSchema } from "@/validators/payment";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const input = listPaymentsSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Payments fetched successfully", await listMyPayments(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
