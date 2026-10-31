import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { visitLimiter } from "../middleware/rateLimit.js";
import { captureVisitSchema } from "../validators/visit.js";
import * as visitController from "../controllers/visitController.js";

export const visitRoutes = Router();

/**
 * Public on purpose: the click being measured happens before any account
 * exists. It carries no session and needs no CSRF token — the address and the
 * user agent are read from the request, and the limiter is what a stranger gets.
 */
visitRoutes.post("/", visitLimiter, validate(captureVisitSchema), visitController.capture);
