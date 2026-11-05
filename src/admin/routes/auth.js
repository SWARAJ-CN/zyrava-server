import { Router } from "express";
import rateLimit from "express-rate-limit";
import { adminEnv } from "../env.js";
import { asyncHandler } from "../lib/async.js";
import { requireAdmin } from "../middleware/auth.js";
import * as authService from "../services/authService.js";

export const authRoutes = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many admin sign-in attempts. Try again in a few minutes." },
});

authRoutes.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    const result = await authService.login({ email, password });
    res.json(result);
  })
);

authRoutes.get(
  "/me",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      admin: req.admin,
      config: { allowDelete: adminEnv.allowDelete, apiUrl: adminEnv.apiUrl },
    });
  })
);
