import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { database } from "./helpers/customizationDatabase.js";
import { CustomizationPurchase } from "../src/models/CustomizationPurchase.js";
import { paymentSettings } from "../src/services/paymentSettingsService.js";
import { env } from "../src/config/env.js";
import { razorpay, validSignature } from "../src/services/razorpayService.js";
import * as payments from "../src/services/customizationPaymentService.js";
import * as customization from "../src/services/customizationService.js";
import {
  createCustomizationOrderSchema,
  customizationConfig,
} from "../src/validators/customization.js";
const a = "000000000000000000000001",
  b = "000000000000000000000002",
  reserved = "000000000000000000000003";
const config = customizationConfig.parse({
  title: "Paid look",
  accent: "#ed70aa",
  background: "#20141c",
  surface: "#32212c",
  text: "#fff4fa",
  loadingAnimation: "couples-1",
  headerAnimation: "couples-2",
  lyricsAnimation: "couples-3",
  loadingMessage: "Hello",
  durationMinutes: 60,
});
const secret = "test-only-razorpay-secret";
function fixture(t) {
  const db = database(t),
    purchases = [],
    gatewayOrders = new Map(),
    gatewayPayments = new Map();
  t.mock.method(paymentSettings, "get", async () => ({
    amount: 500,
    currency: "INR",
    keyId: "rzp_test_fixture",
    secret,
    credentialId: "fixture-credential",
  }));
  t.mock.method(paymentSettings, "credential", async () => ({
    keyId: "rzp_test_fixture",
    secret,
  }));
  t.mock.method(
    paymentSettings,
    "webhookSecret",
    async () => "webhook-test-secret",
  );
  const previous = {
    key: env.razorpayKeyId,
    secret: env.razorpayKeySecret,
    webhook: env.razorpayWebhookSecret,
  };
  env.razorpayKeyId = "rzp_test_fixture";
  env.razorpayKeySecret = secret;
  env.razorpayWebhookSecret = "webhook-test-secret";
  t.after(() => {
    env.razorpayKeyId = previous.key;
    env.razorpayKeySecret = previous.secret;
    env.razorpayWebhookSecret = previous.webhook;
  });
  t.mock.method(CustomizationPurchase, "findOne", (filter) =>
    db.query(purchases.find((p) => db.matches(p, filter)) ?? null),
  );
  t.mock.method(CustomizationPurchase, "findById", (id) =>
    db.query(purchases.find((p) => p._id === String(id)) ?? null),
  );
  t.mock.method(CustomizationPurchase, "find", (filter) =>
    db.query(purchases.filter((p) => db.matches(p, filter))),
  );
  t.mock.method(CustomizationPurchase, "create", async (input) => {
    if (
      purchases.some(
        (p) => p.user === input.user && p.requestId === input.requestId,
      )
    )
      throw Object.assign(new Error("Duplicate"), { code: 11000 });
    const p = {
      _id: String(100 + purchases.length).padStart(24, "0"),
      status: "creating",
      createdAt: new Date(),
      ...structuredClone(input),
    };
    purchases.push(p);
    return { ...p, toObject: () => structuredClone(p) };
  });
  t.mock.method(CustomizationPurchase, "updateOne", async (filter, update) => {
    const p = purchases.find((p) => db.matches(p, filter));
    if (p) Object.assign(p, structuredClone(update.$set));
    return { modifiedCount: p ? 1 : 0 };
  });
  let tail = Promise.resolve();
  t.mock.method(mongoose.connection, "transaction", (fn) => {
    const task = tail.then(async () => {
      const snapshots = [db.users, db.designs, purchases].map((rows) =>
        structuredClone(rows),
      );
      try {
        return await fn({ fixtureSession: true });
      } catch (e) {
        [db.users, db.designs, purchases].forEach((rows, i) =>
          rows.splice(0, rows.length, ...snapshots[i]),
        );
        throw e;
      }
    });
    tail = task.catch(() => {});
    return task;
  });
  t.mock.method(razorpay, "createOrder", async (receipt, purchase) => {
    const id = "order_test" + gatewayOrders.size;
    const order = {
      id,
      receipt,
      amount: purchase.amount,
      currency: purchase.currency,
      amount_paid: 0,
      amount_due: purchase.amount,
      status: "created",
    };
    gatewayOrders.set(id, order);
    return { ...order };
  });
  t.mock.method(razorpay, "order", async (id) =>
    structuredClone(gatewayOrders.get(id)),
  );
  t.mock.method(razorpay, "payment", async (id) =>
    structuredClone(gatewayPayments.get(id)),
  );
  t.mock.method(razorpay, "orderPayments", async (id) => ({
    items: structuredClone(
      [...gatewayPayments.values()].filter((p) => p.order_id === id),
    ),
  }));
  t.mock.method(razorpay, "capture", async (id) => {
    const p = gatewayPayments.get(id);
    p.status = "captured";
    p.captured = true;
    Object.assign(gatewayOrders.get(p.order_id), {
      status: "paid",
      amount_paid: 500,
      amount_due: 0,
    });
    return { ...p };
  });
  const input = (recipientId = a) => ({
    recipientId,
    config: structuredClone(config),
    requestId: randomUUID(),
    expectedAmount: 500,
  });
  function paid(purchase, overrides = {}) {
    const p = {
      id: "pay_test" + gatewayPayments.size,
      order_id: purchase.orderId,
      amount: 500,
      currency: "INR",
      status: "captured",
      captured: true,
      amount_refunded: 0,
      ...overrides,
    };
    gatewayPayments.set(p.id, p);
    Object.assign(gatewayOrders.get(purchase.orderId), {
      status: "paid",
      amount_paid: 500,
      amount_due: 0,
    });
    return p;
  }
  function proof(purchase, payment) {
    return {
      purchaseId: purchase.id,
      razorpay_order_id: purchase.orderId,
      razorpay_payment_id: payment.id,
      razorpay_signature: createHmac("sha256", secret)
        .update(purchase.orderId + "|" + payment.id)
        .digest("hex"),
    };
  }
  return {
    ...db,
    purchases,
    gatewayOrders,
    gatewayPayments,
    input,
    paid,
    proof,
  };
}
test("checkout fixes price, validates ownership/recipient, snapshots design and reuses request IDs", async (t) => {
  const f = fixture(t),
    input = f.input();
  const p = await payments.createOrder(a, input);
  assert.equal(p.amount, 500);
  assert.equal(p.currency, "INR");
  assert.equal(p.keyId, "rzp_test_fixture");
  assert.equal(f.designs.length, 0);
  assert.equal(f.users[0].customization, null);
  assert.deepEqual(await payments.createOrder(a, input), p);
  assert.equal(razorpay.createOrder.mock.calls.length, 1);
  await assert.rejects(
    payments.createOrder(a, {
      ...input,
      config: { ...config, title: "Changed" },
    }),
    { status: 409 },
  );
  await assert.rejects(payments.createOrder(reserved, f.input()), {
    status: 403,
  });
  await assert.rejects(payments.createOrder(a, f.input(reserved)), {
    status: 404,
  });
  const schemaInput = {
    body: { ...f.input(), amount: 1 },
    params: {},
    query: {},
  };
  assert.equal(
    createCustomizationOrderSchema.safeParse(schemaInput).success,
    false,
  );
  assert.equal(
    JSON.stringify(await payments.listPayments(b)),
    JSON.stringify({ payments: [] }),
  );
});
test("forged signature, wrong order, cross-account verification and unpaid orders cannot save", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p),
    proof = f.proof(p, pay);
  await assert.rejects(
    payments.verifyPayment(a, { ...proof, razorpay_signature: "0".repeat(64) }),
    { status: 400 },
  );
  await assert.rejects(
    payments.verifyPayment(a, { ...proof, razorpay_order_id: "order_other" }),
    { status: 400 },
  );
  await assert.rejects(payments.verifyPayment(b, proof), { status: 404 });
  await assert.rejects(payments.checkPayment(b, p.id), { status: 404 });
  f.gatewayPayments.clear();
  assert.equal((await payments.checkPayment(a, p.id)).fulfilled, false);
  assert.equal(f.designs.length, 0);
});
test("underpayment, currency mismatch, refunds and a different order are rejected", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input());
  for (const change of [
    { amount: 1 },
    { currency: "USD" },
    { amount_refunded: 1 },
    { order_id: "order_other" },
  ]) {
    const pay = f.paid(p, change);
    await assert.rejects(payments.verifyPayment(a, f.proof(p, pay)), {
      status: 400,
    });
  }
  assert.equal(f.designs.length, 0);
});
test("captured payment and paid order are both required, with safe manual capture", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p, { status: "authorized", captured: false });
  const done = await payments.verifyPayment(a, f.proof(p, pay));
  assert.equal(done.fulfilled, true);
  assert.equal(razorpay.capture.mock.calls.length, 1);
  assert.equal(f.designs.length, 1);
  assert.equal(done.state.active.config.title, config.title);
  assert.equal(
    +done.state.active.expiresAt - +done.state.active.appliedAt,
    3600000,
  );
});
test("paid order discrepancy cannot fulfill even when payment is captured", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p);
  f.gatewayOrders.get(p.orderId).amount_due = 1;
  assert.equal(
    (await payments.verifyPayment(a, f.proof(p, pay))).fulfilled,
    false,
  );
  assert.equal(f.designs.length, 0);
});
test("duplicate and concurrent confirmations commit once and cannot restore a removed theme", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p);
  await Promise.all([
    payments.verifyPayment(a, f.proof(p, pay)),
    payments.checkPayment(a, p.id),
  ]);
  assert.equal(f.designs.length, 1);
  assert.equal(f.purchases[0].status, "fulfilled");
  const timestamp = f.users[0].customization.appliedAt;
  await customization.resetCustomization(a);
  await payments.verifyPayment(a, f.proof(p, pay));
  assert.equal(f.users[0].customization, undefined);
  assert.ok(timestamp);
  assert.equal((await payments.listPayments(a)).payments.length, 0);
});
test("database failure rolls back both the design and receipt; retry fulfills without repaying", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p);
  const normal = CustomizationPurchase.updateOne;
  CustomizationPurchase.updateOne = async (...args) => {
    if (args[1]?.$set?.status === "fulfilled")
      throw new Error("Simulated database failure");
    return normal(...args);
  };
  try {
    await assert.rejects(
      payments.verifyPayment(a, f.proof(p, pay)),
      /database failure/,
    );
  } finally {
    CustomizationPurchase.updateOne = normal;
  }
  assert.equal(f.users[0].customization, null);
  assert.equal(f.designs.length, 0);
  assert.equal(f.purchases[0].status, "pending");
  assert.equal((await payments.checkPayment(a, p.id)).fulfilled, true);
});
test("sender pays once; recipient acceptance is free and recovery works without browser proof", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input(b));
  f.paid(p);
  const done = await payments.checkPayment(a, p.id);
  assert.equal(done.fulfilled, true);
  assert.equal(f.users[1].customization, null);
  const incoming = (await customization.readCustomizations(b)).incoming[0];
  assert.equal(
    (
      await customization.respondCustomization(
        b,
        incoming.id,
        true,
        incoming.updatedAt.toISOString(),
      )
    ).active.config.title,
    config.title,
  );
  assert.equal(razorpay.createOrder.mock.calls.length, 1);
});
test("webhooks authenticate raw bytes, reject tampering and safely replay", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input()),
    pay = f.paid(p);
  const raw = Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: pay } },
    }),
  );
  const signature = createHmac("sha256", env.razorpayWebhookSecret)
    .update(raw)
    .digest("hex");
  assert.equal(
    validSignature(raw, "invalid", env.razorpayWebhookSecret),
    false,
  );
  await assert.rejects(
    payments.receiveWebhook(Buffer.concat([raw, Buffer.from(" ")]), signature),
    { status: 400 },
  );
  await payments.receiveWebhook(raw, signature);
  await payments.receiveWebhook(raw, signature);
  assert.equal(f.designs.length, 1);
  assert.equal(f.purchases[0].status, "fulfilled");
});

test("admin price/key changes affect new checkouts, not the amount or key version frozen in existing orders", async (t) => {
  const f = fixture(t),
    input = f.input(),
    old = await payments.createOrder(a, input);
  paymentSettings.get.mock.mockImplementation(async () => ({
    amount: 1200,
    currency: "INR",
    keyId: "rzp_test_newkey",
    secret: "new-secret",
    credentialId: "new-credential",
  }));
  await assert.rejects(payments.createOrder(a, f.input()), { status: 409 });
  assert.equal((await payments.createOrder(a, input)).amount, 500);
  const newer = await payments.createOrder(a, {
    ...f.input(),
    expectedAmount: 1200,
  });
  assert.equal(newer.amount, 1200);
  assert.equal(newer.keyId, "rzp_test_newkey");
  const paid = f.paid(old);
  await payments.verifyPayment(a, f.proof(old, paid));
  assert.equal(
    paymentSettings.credential.mock.calls.at(-1).arguments[0],
    "fixture-credential",
  );
  assert.equal(f.purchases[0].paymentStatus, "captured");
  assert.equal(f.purchases[0].capturedAmount, 500);
});
test("gateway failures and refunds are recorded independently from design fulfillment", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input());
  const failed = f.paid(p, {
    status: "failed",
    captured: false,
    error_code: "BAD_REQUEST_ERROR",
  });
  await payments.checkPayment(a, p.id);
  assert.equal(f.purchases[0].paymentStatus, "failed");
  assert.equal(f.designs.length, 0);
  f.gatewayPayments.delete(failed.id);
  const good = f.paid(p);
  await payments.checkPayment(a, p.id);
  assert.equal(f.purchases[0].status, "fulfilled");
  good.amount_refunded = 500;
  good.status = "refunded";
  await payments.syncPaymentForAdmin(p.id);
  assert.equal(f.purchases[0].paymentStatus, "refunded");
  assert.equal(f.purchases[0].amountRefunded, 500);
  assert.equal(f.purchases[0].status, "fulfilled");
});
test("admin status sync does not capture an authorization", async (t) => {
  const f = fixture(t),
    p = await payments.createOrder(a, f.input());
  f.paid(p, { status: "authorized", captured: false });
  await payments.syncPaymentForAdmin(p.id);
  assert.equal(razorpay.capture.mock.calls.length, 0);
  assert.equal(f.purchases[0].paymentStatus, "authorized");
  assert.equal(f.designs.length, 0);
});

test("birthday wishes and new animation selections survive paid gift fulfillment and recipient acceptance", async (t) => {
  const f = fixture(t);
  const input = f.input(b);
  input.config = customizationConfig.parse({
    ...input.config,
    template: "birthday",
    title: "Happy birthday, Jamie!",
    wishMessage: "A little music and a lot of love. Happy birthday!",
    loadingAnimation: "moments-7",
    headerAnimation: "moments-7",
    lyricsAnimation: "moments-1",
    durationMinutes: 1440,
  });
  const purchase = await payments.createOrder(a, input);
  assert.deepEqual(f.purchases[0].config, input.config);
  assert.equal(f.designs.length, 0);
  f.paid(purchase);
  await payments.checkPayment(a, purchase.id);
  const incoming = (await customization.readCustomizations(b)).incoming[0];
  assert.deepEqual(incoming.config, input.config);
  const accepted = await customization.respondCustomization(
    b,
    incoming.id,
    true,
    incoming.updatedAt.toISOString(),
  );
  assert.deepEqual(accepted.active.config, input.config);
  assert.equal(
    +accepted.active.expiresAt - +accepted.active.appliedAt,
    86400000,
  );
  assert.equal(razorpay.createOrder.mock.calls.length, 1);
  // The recipient can still remove their birthday gift without another charge.
  await customization.removeCustomization(b, incoming.id);
  assert.equal((await customization.readCustomizations(b)).active, null);
  assert.equal(f.purchases[0].status, "fulfilled");
});
