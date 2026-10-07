import "server-only";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { AppError } from "@/lib/http/errors";
import { uniqueQueryParameters } from "@/lib/http/query";
import { successResponse } from "@/lib/http/responses";
import { listShipments } from "@/services/shipment.service";
import { listShipmentsSchema } from "@/validators/shipment";

export async function shipmentListResponse(request: NextRequest, mine = false, search = false) {
  try {
    const actor = await requireUser(request);
    const input = listShipmentsSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    if (search && !input.q) throw new AppError(400, "Search query q is required", "INVALID_QUERY");
    return successResponse("Shipments fetched successfully", await listShipments(actor, input, mine));
  } catch (error) {
    return handleRouteError(error);
  }
}
