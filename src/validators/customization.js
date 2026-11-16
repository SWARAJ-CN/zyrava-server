import { z } from "zod";

export const ANIMATION_IDS = [
  "none",
  "couples-1",
  "couples-2",
  "couples-3",
  "couples-4",
  "moments-1",
  "moments-2",
  "moments-3",
  "moments-4",
  "moments-5",
  "moments-6",
  "moments-7",
];
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.")
  .transform((value) => value.toLowerCase());
const id = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, "Choose a valid user or customization.");
const text = (length) =>
  z
    .string()
    .trim()
    .max(length)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Use plain text without control characters.",
    );
export const customizationConfig = z
  .object({
    template: z.enum(["partner", "birthday"]).optional(),
    wishMessage: text(280).optional(),
    title: text(60).pipe(z.string().min(1)),
    accent: color,
    background: color,
    surface: color,
    text: color,
    loadingAnimation: z.enum(ANIMATION_IDS),
    headerAnimation: z.enum(ANIMATION_IDS),
    lyricsAnimation: z.enum(ANIMATION_IDS),
    loadingMessage: text(140),
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(525600)
      .nullable()
      .default(null),
  })
  .strict();
const envelope = (body) =>
  z.object({
    body,
    query: z.object({}).strict(),
    params: z.object({}).strict(),
  });
export const searchCustomizationSchema = z.object({
  body: z.unknown(),
  query: z.object({ q: z.string().trim().min(3).max(254) }).strict(),
  params: z.object({}).strict(),
});
export const saveCustomizationSchema = envelope(
  z.object({ recipientId: id, config: customizationConfig }).strict(),
);
export const respondCustomizationSchema = envelope(
  z
    .object({ id, accept: z.boolean(), updatedAt: z.string().datetime() })
    .strict(),
);
export const resetCustomizationSchema = envelope(z.object({}).strict());

export const removeCustomizationSchema = envelope(z.object({ id }).strict());

export const createCustomizationOrderSchema = envelope(
  z
    .object({
      requestId: z.string().uuid(),
      expectedAmount: z.number().int().min(100).max(1000000),
      recipientId: id,
      config: customizationConfig,
    })
    .strict(),
);
export const verifyCustomizationPaymentSchema = envelope(
  z
    .object({
      purchaseId: id,
      razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
      razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
      razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .strict(),
);
export const checkCustomizationPaymentSchema = envelope(
  z.object({ purchaseId: id }).strict(),
);

export const paymentHistorySchema = z.object({
  body: z.unknown(),
  params: z.object({}).strict(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .strict(),
});
