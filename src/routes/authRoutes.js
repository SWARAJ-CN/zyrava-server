import { Router } from "express";
import { issueCsrf, verifyCsrf } from "../middleware/csrf.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter, refreshLimiter, registerLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema } from "../validators/auth.js";
import * as authController from "../controllers/authController.js";

export const authRoutes = Router();

// Bootstrap: the SPA calls this once, receives a token and keeps its cookie.
authRoutes.get("/csrf", issueCsrf);

authRoutes.post(
  "/register",
  verifyCsrf,
  registerLimiter,
  validate(registerSchema),
  authController.register
);
authRoutes.post("/login", verifyCsrf, authLimiter, validate(loginSchema), authController.login);
authRoutes.post("/refresh", verifyCsrf, refreshLimiter, authController.refresh);
authRoutes.post("/logout", verifyCsrf, authController.logout);
authRoutes.get("/me", requireAuth, authController.me);
