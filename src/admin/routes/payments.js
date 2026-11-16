import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/http.js";
import { paymentSettings } from "../../services/paymentSettingsService.js";
import { syncPaymentForAdmin } from "../../services/customizationPaymentService.js";
import { listPayments } from "../services/paymentsService.js";
export const paymentsRoutes = Router();
paymentsRoutes.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const statuses = [
  "all",
  "created",
  "authorized",
  "captured",
  "failed",
  "refunded",
  "partially_refunded",
  "order_failed",
];
export const paymentListSchema = z.object({
  body: z.unknown(),
  params: z.object({}).strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().trim().max(100).default(""),
      paymentStatus: z.enum(statuses).default("all"),
      fulfillment: z
        .enum(["all", "creating", "pending", "fulfilled"])
        .default("all"),
    })
    .strict(),
});
export const paymentSettingsSchema = z.object({
  body: z
    .object({
      amountRupees: z.number().int().min(1).max(10000),
      keyId: z
        .string()
        .trim()
        .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,64}$/)
        .optional(),
      keySecret: z.string().trim().min(12).max(128).optional(),
      webhookSecret: z.string().trim().min(16).max(256).optional(),
    })
    .strict()
    .refine(
      (v) => Boolean(v.keyId) === Boolean(v.keySecret),
      "Provide both Razorpay key ID and secret to replace credentials.",
    ),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
});
const writeLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  keyGenerator: (req) => req.admin.email,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
paymentsRoutes.get(
  "/",
  validate(paymentListSchema),
  asyncHandler(async (req, res) =>
    res.json(await listPayments(req.valid.query)),
  ),
);
paymentsRoutes.get(
  "/settings",
  asyncHandler(async (req, res) => res.json(await paymentSettings.public())),
);
paymentsRoutes.post(
  "/settings",
  writeLimit,
  validate(paymentSettingsSchema),
  asyncHandler(async (req, res) =>
    res.json(await paymentSettings.update(req.valid.body, req.admin.email)),
  ),
);
paymentsRoutes.post(
  "/:id/sync",
  writeLimit,
  validate(
    z.object({
      body: z.object({}).strict(),
      query: z.object({}).strict(),
      params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }).strict(),
    }),
  ),
  asyncHandler(async (req, res) =>
    res.json(await syncPaymentForAdmin(req.valid.params.id)),
  ),
);
