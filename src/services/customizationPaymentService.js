import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { CustomizationPurchase } from "../models/CustomizationPurchase.js";
import {
  assertCustomizer,
  recipient,
  persistCustomization,
  readCustomizations,
} from "./customizationService.js";
import { razorpay, validSignature } from "./razorpayService.js";
import { paymentSettings } from "./paymentSettingsService.js";
import { AppError } from "../utils/http.js";

function purchaseView(p) {
  return {
    id: String(p._id),
    orderId: p.orderId,
    keyId: p.keyId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    title: p.config.title,
    recipientId: String(p.recipient),
    createdAt: p.createdAt,
  };
}
async function ownedPurchase(userId, id) {
  await assertCustomizer(userId);
  const p = await CustomizationPurchase.findOne({
    _id: id,
    user: userId,
  }).lean();
  if (!p) throw new AppError(404, "Payment not found.");
  return p;
}
export async function createOrder(userId, input) {
  await assertCustomizer(userId);
  await recipient(input.recipientId);
  const pricing = await paymentSettings.get();
  let purchase = await CustomizationPurchase.findOne({
    user: userId,
    requestId: input.requestId,
  }).lean();
  if (purchase) {
    if (
      String(purchase.recipient) !== input.recipientId ||
      !isDeepStrictEqual(purchase.config, input.config)
    )
      throw new AppError(
        409,
        "This payment belongs to a different design. Start a new checkout.",
      );
    if (!purchase.orderId)
      throw new AppError(
        409,
        "Checkout is still starting. Please try again shortly.",
      );
    return purchaseView(purchase);
  }
  if (input.expectedAmount !== pricing.amount)
    throw new AppError(
      409,
      "The customization price changed. Review the new price and try again.",
    );
  try {
    purchase = await CustomizationPurchase.create({
      user: userId,
      recipient: input.recipientId,
      purpose:
        String(userId) === input.recipientId
          ? "customization_self"
          : "customization_gift",
      requestId: input.requestId,
      config: input.config,
      keyId: pricing.keyId,
      credentialId: pricing.credentialId,
      amount: pricing.amount,
      currency: pricing.currency,
    });
  } catch (error) {
    if (error.code === 11000)
      throw new AppError(
        409,
        "Checkout is already starting. Please wait a moment.",
      );
    throw error;
  }
  // Save the immutable purchase first. No browser chooses an amount, owner or receipt.
  let order;
  try {
    order = await razorpay.createOrder(`custom_${purchase._id}`, purchase);
  } catch (error) {
    await CustomizationPurchase.updateOne(
      { _id: purchase._id },
      {
        $set: {
          paymentStatus: "order_failed",
          failureCode: "ORDER_CREATE_FAILED",
          lastCheckedAt: new Date(),
        },
      },
    );
    throw error;
  }
  if (
    !/^order_[A-Za-z0-9]+$/.test(order.id) ||
    order.amount !== purchase.amount ||
    order.currency !== purchase.currency
  )
    throw new AppError(
      502,
      "Razorpay returned an unexpected order. No design has been saved.",
    );
  await CustomizationPurchase.updateOne(
    { _id: purchase._id },
    { $set: { orderId: order.id, status: "pending" } },
  );
  return purchaseView({
    ...purchase.toObject(),
    orderId: order.id,
    status: "pending",
  });
}
export async function listPayments(userId) {
  await assertCustomizer(userId);
  const rows = await CustomizationPurchase.find({
    user: userId,
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  return { payments: rows.map(purchaseView) };
}
function matchesPayment(payment, purchase) {
  return (
    payment &&
    payment.order_id === purchase.orderId &&
    payment.amount === purchase.amount &&
    payment.currency === purchase.currency
  );
}
async function recordPayment(purchase, payment) {
  if (!matchesPayment(payment, purchase)) return;
  const refunded = Math.max(
    0,
    Math.min(purchase.amount, Number(payment.amount_refunded) || 0),
  );
  const status = refunded
    ? refunded >= purchase.amount
      ? "refunded"
      : "partially_refunded"
    : payment.status;
  if (
    ![
      "created",
      "authorized",
      "captured",
      "failed",
      "refunded",
      "partially_refunded",
    ].includes(status)
  )
    return;
  const values = {
    paymentStatus: status,
    lastPaymentId: payment.id,
    lastCheckedAt: new Date(),
    amountRefunded: refunded,
    failureCode:
      status === "failed"
        ? String(payment.error_code || "PAYMENT_FAILED")
            .replace(/[^A-Z0-9_]/gi, "")
            .slice(0, 64)
        : null,
  };
  if (payment.captured === true || refunded > 0) {
    values.capturedAmount = purchase.amount;
    values.capturedAt = purchase.capturedAt ?? new Date();
  }
  await CustomizationPurchase.updateOne(
    { _id: purchase._id },
    { $set: values },
  );
}
async function fulfill(purchase, paymentId) {
  // The purchase and its design/snapshot commit together. Duplicate callbacks,
  // webhook retries and concurrent status checks cannot apply a purchase twice.
  await mongoose.connection.transaction(async (session) => {
    const fresh = await CustomizationPurchase.findById(purchase._id)
      .session(session)
      .lean();
    if (!fresh || fresh.status === "fulfilled") return;
    const design = await persistCustomization(
      String(fresh.user),
      {
        recipientId: String(fresh.recipient),
        config: fresh.config,
      },
      session,
    );
    await CustomizationPurchase.updateOne(
      { _id: fresh._id },
      {
        $set: {
          status: "fulfilled",
          paymentId,
          fulfilledAt: new Date(),
          designId: design._id,
        },
      },
      { session },
    );
  });
}
async function reconcile(
  purchase,
  paymentId,
  { force = false, capture = true } = {},
) {
  if (purchase.status === "fulfilled" && !force) return true;
  if (!purchase.orderId) return false;
  let payment;
  if (paymentId) payment = await razorpay.payment(paymentId, purchase);
  else {
    const response = await razorpay.orderPayments(purchase.orderId, purchase);
    const items = (response.items ?? [])
      .filter((p) => matchesPayment(p, purchase))
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    payment =
      items.find((p) => p.captured === true || p.status === "refunded") ??
      items.find((p) => p.status === "authorized") ??
      items[0];
  }
  if (!payment) {
    await CustomizationPurchase.updateOne(
      { _id: purchase._id },
      { $set: { lastCheckedAt: new Date() } },
    );
    return false;
  }
  if (!matchesPayment(payment, purchase))
    throw new AppError(
      400,
      "This payment does not match the customization order.",
    );
  await recordPayment(purchase, payment);
  if (payment.amount_refunded > 0) {
    if (paymentId) throw new AppError(400, "This payment has been refunded.");
    return purchase.status === "fulfilled";
  }
  if (payment.status === "authorized" && capture) {
    try {
      payment = await razorpay.capture(payment.id, purchase);
    } catch {
      payment = await razorpay.payment(payment.id, purchase);
    }
    await recordPayment(purchase, payment);
  }
  if (
    !matchesPayment(payment, purchase) ||
    payment.status !== "captured" ||
    payment.captured !== true ||
    payment.amount_refunded > 0
  )
    return false;
  const order = await razorpay.order(purchase.orderId, purchase);
  if (
    order.id !== purchase.orderId ||
    order.status !== "paid" ||
    order.amount !== purchase.amount ||
    order.currency !== purchase.currency ||
    order.amount_paid !== purchase.amount ||
    order.amount_due !== 0
  )
    return false;
  await fulfill(purchase, payment.id);
  return true;
}
export async function syncPaymentForAdmin(id) {
  const purchase = await CustomizationPurchase.findById(id).lean();
  if (!purchase) throw new AppError(404, "Payment not found.");
  await reconcile(purchase, undefined, { force: true, capture: false });
  return { synced: true };
}
async function result(userId, purchase, paymentId) {
  const fulfilled = await reconcile(purchase, paymentId);
  return {
    fulfilled,
    purchaseId: String(purchase._id),
    state: await readCustomizations(userId),
  };
}
export async function verifyPayment(userId, input) {
  const purchase = await ownedPurchase(userId, input.purchaseId);
  if (
    input.razorpay_order_id !== purchase.orderId ||
    !validSignature(
      `${purchase.orderId}|${input.razorpay_payment_id}`,
      input.razorpay_signature,
      (await paymentSettings.credential(purchase.credentialId, purchase.keyId))
        .secret,
    )
  )
    throw new AppError(
      400,
      "Payment signature could not be verified. Use Check payment to recover your purchase.",
    );
  return result(userId, purchase, input.razorpay_payment_id);
}
export async function checkPayment(userId, purchaseId) {
  return result(userId, await ownedPurchase(userId, purchaseId));
}
export async function receiveWebhook(rawBody, signature) {
  const webhookSecret = await paymentSettings.webhookSecret();
  if (!webhookSecret)
    throw new AppError(503, "Payment webhook is not configured.");
  if (
    !Buffer.isBuffer(rawBody) ||
    !validSignature(rawBody, signature, webhookSecret)
  )
    throw new AppError(400, "Invalid payment webhook signature.");
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid webhook payload.");
  }
  if (
    ![
      "payment.captured",
      "payment.authorized",
      "payment.failed",
      "order.paid",
      "refund.processed",
    ].includes(event.event)
  )
    return;
  const payment = event.payload?.payment?.entity;
  const orderId = payment?.order_id ?? event.payload?.order?.entity?.id;
  let purchase;
  if (typeof orderId === "string")
    purchase = await CustomizationPurchase.findOne({ orderId }).lean();
  else {
    const paymentId = event.payload?.refund?.entity?.payment_id;
    if (typeof paymentId === "string")
      purchase = await CustomizationPurchase.findOne({
        lastPaymentId: paymentId,
      }).lean();
  }
  if (purchase)
    await reconcile(purchase, undefined, { force: true, capture: false });
}
