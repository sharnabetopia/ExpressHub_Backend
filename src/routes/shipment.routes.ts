import { Router } from "express";

import { sendSuccess } from "../utils/response";

const router = Router();

router.post("/", (req, res) => {
  const payload = req.body ?? {};

  return res.status(201).json(
    sendSuccess("Shipment created successfully", {
      id: "shipment_123",
      trackingNumber: "EXP-2026-1001",
      status: "CREATED",
      customerId: payload.customerId ?? "user_123",
      pickupAddress: payload.pickupAddress ?? "Dhaka",
      deliveryAddress: payload.deliveryAddress ?? "Chattogram",
      price: payload.price ?? 420,
    }),
  );
});

router.get("/", (_req, res) => {
  return res.status(200).json(
    sendSuccess("Shipments fetched", {
      items: [
        {
          id: "shipment_123",
          trackingNumber: "EXP-2026-1001",
          status: "IN_TRANSIT",
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
    }),
  );
});

router.get("/:id", (req, res) => {
  return res.status(200).json(
    sendSuccess("Shipment details fetched", {
      id: req.params.id,
      trackingNumber: "EXP-2026-1001",
      status: "IN_TRANSIT",
      pickupAddress: "Dhaka",
      deliveryAddress: "Chattogram",
    }),
  );
});

router.patch("/:id/status", (req, res) => {
  const payload = req.body ?? {};

  return res.status(200).json(
    sendSuccess("Shipment status updated", {
      id: req.params.id,
      status: payload.status ?? "OUT_FOR_DELIVERY",
    }),
  );
});

export default router;
