import type { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/auth/require-user";
import { handleRouteError } from "@/lib/auth/route-helpers";
import { successResponse } from "@/lib/http/responses";
import { uniqueQueryParameters } from "@/lib/http/query";
import { listShipments } from "@/services/shipment.service";
import { listShipmentsSchema } from "@/validators/shipment";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = requireRole(await requireUser(request), "ADMIN");
    const input = listShipmentsSchema.parse(uniqueQueryParameters(request.nextUrl.searchParams));
    return successResponse("Shipments fetched successfully", await listShipments(actor, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
