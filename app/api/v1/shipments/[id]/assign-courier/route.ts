import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { assignCourier } from "@/services/shipment.service";
import { shipmentIdSchema, assignCourierSchema } from "@/validators/shipment";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const id = shipmentIdSchema.parse((await context.params).id);
    const input = await parseRequestBody(request, assignCourierSchema);
    const shipment = await assignCourier(actor, id, input);
    return successResponse("Shipment updated successfully", { shipment });
  } catch (error) {
    return handleRouteError(error);
  }
}
