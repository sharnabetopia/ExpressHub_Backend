import { softDeleteSchema } from "@/validators/soft-delete";
import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getShipment, softDeleteShipment } from "@/services/shipment.service";
import { shipmentIdSchema } from "@/validators/shipment";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const id = shipmentIdSchema.parse((await context.params).id);
    const shipment = await getShipment(actor, id);
    return successResponse("Shipment fetched successfully", { shipment });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const id = shipmentIdSchema.parse((await context.params).id);
    const { reason } = await parseRequestBody(request, softDeleteSchema);
    return successResponse("Shipment deleted successfully", { shipment: await softDeleteShipment(actor, id, reason) });
  } catch (error) {
    return handleRouteError(error);
  }
}
