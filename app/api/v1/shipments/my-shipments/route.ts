import type { NextRequest } from "next/server";
import { shipmentListResponse } from "@/lib/http/shipment-list";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return shipmentListResponse(request, true, false);
}
