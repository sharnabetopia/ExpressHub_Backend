import { Router } from "express";

import { sendSuccess } from "../utils/response";

const router = Router();

router.post("/register", (req, res) => {
  const payload = req.body ?? {};

  return res.status(201).json(
    sendSuccess("User registered successfully", {
      user: {
        id: "user_123",
        name: payload.name ?? "Demo User",
        email: payload.email ?? "demo@example.com",
        role: "CUSTOMER",
      },
    }),
  );
});

router.post("/login", (req, res) => {
  const payload = req.body ?? {};

  return res.status(200).json(
    sendSuccess("Login successful", {
      accessToken: "demo-token",
      refreshToken: "demo-refresh-token",
      user: {
        id: "user_123",
        email: payload.email ?? "demo@example.com",
        role: "CUSTOMER",
      },
    }),
  );
});

router.post("/refresh-token", (_req, res) => {
  return res.status(200).json(
    sendSuccess("Token refreshed successfully", {
      accessToken: "new-demo-token",
    }),
  );
});

export default router;
