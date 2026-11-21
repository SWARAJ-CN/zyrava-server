import { Router } from "express";
import { issueCsrf, verifyCsrf } from "../middleware/csrf.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter, refreshLimiter, registerLimiter, otpLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema, verifyEmailSchema, resendEmailSchema, requestResetSchema, finishResetSchema } from "../validators/auth.js";
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

authRoutes.post("/email/verify", verifyCsrf, otpLimiter, validate(verifyEmailSchema), authController.verifyEmailLogin);
authRoutes.post("/email/resend", verifyCsrf, otpLimiter, validate(resendEmailSchema), authController.resendEmail);
authRoutes.post("/password/request", verifyCsrf, otpLimiter, validate(requestResetSchema), authController.requestReset);
authRoutes.post("/password/verify", verifyCsrf, otpLimiter, validate(verifyEmailSchema), authController.verifyReset);
authRoutes.post("/password/reset", verifyCsrf, otpLimiter, validate(finishResetSchema), authController.finishReset);
