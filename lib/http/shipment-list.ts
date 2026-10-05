import "server-only";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { successResponse } from "@/lib/http/responses";
import { listShipments } from "@/services/shipment.service";
import { listShipmentsSchema } from "@/validators/shipment";

export async function shipmentListResponse(request: NextRequest, mine = false, search = false) {
  try {
    const actor = await requireUser(request);
    const params = request.nextUrl.searchParams;
    for (const key of params.keys()) {
      if (params.getAll(key).length > 1) throw new AppError(400, "Duplicate query parameters are not allowed", "INVALID_QUERY");
    }
    const input = listShipmentsSchema.parse(Object.fromEntries(params));
    if (search && !input.q) throw new AppError(400, "Search query q is required", "INVALID_QUERY");
    return successResponse("Shipments fetched successfully", await listShipments(actor, input, mine));
  } catch (error) {
    return handleRouteError(error);
  }
}
