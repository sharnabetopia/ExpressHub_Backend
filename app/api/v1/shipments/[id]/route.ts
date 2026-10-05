import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { getShipment } from "@/services/shipment.service";
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
