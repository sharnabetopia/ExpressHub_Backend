import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError, parseRequestBody } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { createShipment } from "@/services/shipment.service";
import { createShipmentSchema } from "@/validators/shipment";
import { shipmentListResponse } from "@/lib/http/shipment-list";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return shipmentListResponse(request);
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const input = await parseRequestBody(request, createShipmentSchema);
    const shipment = await createShipment(actor, input);
    return successResponse("Shipment created successfully", { shipment }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
