import { Router } from "express";

import authRoutes from "./auth.routes";
import shipmentRoutes from "./shipment.routes";
import userRoutes from "./user.routes";
import { sendSuccess } from "../utils/response";

const router = Router();

router.get("/health", (_req, res) => {
  return res.status(200).json(
    sendSuccess("API is healthy", {
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/shipments", shipmentRoutes);

export default router;
