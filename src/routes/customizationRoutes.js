import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/http.js";
import {
  searchCustomizationSchema,
  paymentHistorySchema,
  saveCustomizationSchema,
  respondCustomizationSchema,
  resetCustomizationSchema,
  removeCustomizationSchema,
  createCustomizationOrderSchema,
  createDonationOrderSchema,
  verifyCustomizationPaymentSchema,
  checkCustomizationPaymentSchema,
} from "../validators/customization.js";
import { paymentSettings } from "../services/paymentSettingsService.js";
import { readPaymentHistory } from "../services/paymentHistoryService.js";
import * as payments from "../services/customizationPaymentService.js";
import * as service from "../services/customizationService.js";

export const customizationRoutes = Router();
customizationRoutes.use(requireAuth);
customizationRoutes.use(
  rateLimit({
    windowMs: 60_000,
    limit: 45,
    keyGenerator: (req) => req.userId,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Please wait a moment before customizing again." },
  }),
);
customizationRoutes.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
customizationRoutes.get(
  "/",
  asyncHandler(async (req, res) =>
    res.json(await service.readCustomizations(req.userId)),
  ),
);
customizationRoutes.get(
  "/users",
  validate(searchCustomizationSchema),
  asyncHandler(async (req, res) =>
    res.json({
      users: await service.searchRecipients(req.userId, req.valid.query.q),
    }),
  ),
);
const shareLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  keyGenerator: (req) => req.userId,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again in a few minutes.",
  },
});
customizationRoutes.post(
  "/save",
  verifyCsrf,
  shareLimiter,
  validate(saveCustomizationSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.saveCustomization(req.userId, req.valid.body));
  }),
);
customizationRoutes.post(
  "/respond",
  verifyCsrf,
  validate(respondCustomizationSchema),
  asyncHandler(async (req, res) =>
    res.json(
      await service.respondCustomization(
        req.userId,
        req.valid.body.id,
        req.valid.body.accept,
        req.valid.body.updatedAt,
      ),
    ),
  ),
);
customizationRoutes.post(
  "/reset",
  verifyCsrf,
  validate(resetCustomizationSchema),
  asyncHandler(async (req, res) =>
    res.json(await service.resetCustomization(req.userId)),
  ),
);

customizationRoutes.post(
  "/remove",
  verifyCsrf,
  validate(removeCustomizationSchema),
  asyncHandler(async (req, res) =>
    res.json(await service.removeCustomization(req.userId, req.valid.body.id)),
  ),
);

customizationRoutes.get(
  "/payments",
  asyncHandler(async (req, res) =>
    res.json(await payments.listPayments(req.userId)),
  ),
);
customizationRoutes.post(
  "/payments/order",
  verifyCsrf,
  shareLimiter,
  validate(createCustomizationOrderSchema),
  asyncHandler(async (req, res) =>
    res.json(await payments.createOrder(req.userId, req.valid.body)),
  ),
);
customizationRoutes.post(
  "/donations/order",
  verifyCsrf,
  shareLimiter,
  validate(createDonationOrderSchema),
  asyncHandler(async (req, res) =>
    res.json(await payments.createDonationOrder(req.userId, req.valid.body)),
  ),
);
customizationRoutes.post(
  "/payments/verify",
  verifyCsrf,
  validate(verifyCustomizationPaymentSchema),
  asyncHandler(async (req, res) =>
    res.json(await payments.verifyPayment(req.userId, req.valid.body)),
  ),
);
customizationRoutes.post(
  "/payments/check",
  verifyCsrf,
  validate(checkCustomizationPaymentSchema),
  asyncHandler(async (req, res) =>
    res.json(
      await payments.checkPayment(req.userId, req.valid.body.purchaseId),
    ),
  ),
);

customizationRoutes.get(
  "/payments/config",
  asyncHandler(async (req, res) => {
    await service.assertCustomizer(req.userId);
    const config = await paymentSettings.public();
    res.json({
      amount: config.amount,
      currency: config.currency,
      configured: config.configured,
    });
  }),
);

customizationRoutes.get(
  "/payments/history",
  validate(paymentHistorySchema),
  asyncHandler(async (req, res) => {
    await service.assertCustomizer(req.userId);
    res.json(await readPaymentHistory(req.userId, req.valid.query));
  }),
);
