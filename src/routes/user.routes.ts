import { Router } from "express";

import { sendSuccess } from "../utils/response";

const router = Router();

router.get("/me", (_req, res) => {
  return res.status(200).json(
    sendSuccess("User profile fetched", {
      id: "user_123",
      name: "Demo User",
      email: "demo@example.com",
      role: "CUSTOMER",
      phone: "+8801700000000",
    }),
  );
});

router.patch("/me", (req, res) => {
  const payload = req.body ?? {};

  return res.status(200).json(
    sendSuccess("Profile updated successfully", {
      id: "user_123",
      ...payload,
    }),
  );
});

export default router;
