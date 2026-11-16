import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { PaymentSettings } from "../src/models/PaymentSettings.js";
import { env } from "../src/config/env.js";
import { adminEnv } from "../src/admin/env.js";
import { requireAdmin } from "../src/admin/middleware/auth.js";
import {
  paymentsRoutes,
  paymentSettingsSchema,
} from "../src/admin/routes/payments.js";
import {
  paymentSettings,
  credentialVerifier,
  encryptPaymentSecret,
  decryptPaymentSecret,
} from "../src/services/paymentSettingsService.js";
import { signAccessToken } from "../src/utils/tokens.js";
function fixture(t) {
  const prior = {
    key: env.paymentSettingsEncryptionKey,
    id: env.razorpayKeyId,
    secret: env.razorpayKeySecret,
    webhook: env.razorpayWebhookSecret,
  };
  env.paymentSettingsEncryptionKey = randomBytes(32).toString("base64");
  env.razorpayKeyId = "rzp_test_initial";
  env.razorpayKeySecret = "original-test-secret";
  env.razorpayWebhookSecret = undefined;
  t.after(() => {
    env.paymentSettingsEncryptionKey = prior.key;
    env.razorpayKeyId = prior.id;
    env.razorpayKeySecret = prior.secret;
    env.razorpayWebhookSecret = prior.webhook;
  });
  let row = null;
  const query = () => ({ lean: async () => structuredClone(row) });
  t.mock.method(PaymentSettings, "findById", query);
  t.mock.method(PaymentSettings, "findOneAndUpdate", (_filter, update) => {
    if (!row)
      row = {
        _id: "customization",
        ...structuredClone(update.$setOnInsert),
        updatedAt: new Date(),
      };
    if (update.$set)
      Object.assign(row, structuredClone(update.$set), {
        updatedAt: new Date(),
      });
    if (update.$push?.credentials)
      row.credentials.push(structuredClone(update.$push.credentials));
    return query();
  });
  t.mock.method(credentialVerifier, "check", async () => {});
  return { row: () => row };
}
test("credentials are encrypted, never returned publicly, and old versions survive an admin price/key update", async (t) => {
  const f = fixture(t),
    initial = await paymentSettings.get();
  assert.equal(initial.amount, 500);
  assert.equal(initial.secret, "original-test-secret");
  assert.ok(!JSON.stringify(f.row()).includes("original-test-secret"));
  const next = await paymentSettings.update(
    {
      amountRupees: 12,
      keyId: "rzp_live_updated",
      keySecret: "updated-test-secret",
      webhookSecret: "webhook-test-secret-123",
    },
    "admin@example.com",
  );
  assert.equal(next.amount, 1200);
  assert.equal(next.keyId, "rzp_live_updated");
  assert.equal(next.updatedBy, "admin@example.com");
  assert.ok(!JSON.stringify(next).includes("updated-test-secret"));
  assert.ok(!JSON.stringify(next).includes("webhook-test-secret"));
  assert.ok(!JSON.stringify(f.row()).includes("updated-test-secret"));
  assert.equal(
    (await paymentSettings.credential(initial.credentialId)).secret,
    "original-test-secret",
  );
  assert.equal((await paymentSettings.get()).secret, "updated-test-secret");
  assert.equal(
    await paymentSettings.webhookSecret(),
    "webhook-test-secret-123",
  );
  await paymentSettings.update({ amountRupees: 7 }, "admin@example.com");
  assert.equal((await paymentSettings.get()).secret, "updated-test-secret");
});
test("authenticated encryption rejects ciphertext changes and the wrong credential context", (t) => {
  fixture(t);
  const sealed = encryptPaymentSecret("not-a-real-secret", "credential-one");
  assert.equal(
    decryptPaymentSecret(sealed, "credential-one"),
    "not-a-real-secret",
  );
  assert.throws(() => decryptPaymentSecret(sealed, "credential-two"), {
    status: 503,
  });
  const parts = sealed.split(":");
  const tag = Buffer.from(parts[1], "base64");
  tag[0] ^= 1;
  parts[1] = tag.toString("base64");
  assert.throws(() => decryptPaymentSecret(parts.join(":"), "credential-one"), {
    status: 503,
  });
});
test("invalid new Razorpay credentials leave the price and active key unchanged", async (t) => {
  fixture(t);
  await paymentSettings.get();
  credentialVerifier.check.mock.mockImplementation(async () => {
    throw new Error("Rejected keys");
  });
  await assert.rejects(
    paymentSettings.update(
      {
        amountRupees: 100,
        keyId: "rzp_test_invalid",
        keySecret: "invalid-new-secret",
      },
      "admin@example.com",
    ),
    /Rejected/,
  );
  assert.equal((await paymentSettings.get()).amount, 500);
  assert.equal((await paymentSettings.get()).keyId, "rzp_test_initial");
  for (const body of [
    { amountRupees: 0 },
    { amountRupees: 5.5 },
    { amountRupees: 10001 },
    { amountRupees: 5, keyId: "rzp_test_partial" },
    { amountRupees: 5, keySecret: "secret-without-key" },
  ])
    assert.equal(
      paymentSettingsSchema.safeParse({ body, params: {}, query: {} }).success,
      false,
    );
});
test("only admin tokens can view or edit settings; responses contain no secrets", async (t) => {
  fixture(t);
  const old = adminEnv.configured;
  adminEnv.configured = true;
  t.after(() => {
    adminEnv.configured = old;
  });
  const app = express();
  app.use(express.json());
  app.use("/payments", requireAdmin, paymentsRoutes);
  app.use((e, req, res, next) =>
    res.status(e.status ?? 500).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/payments/settings`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (
      await fetch(url, {
        headers: {
          Authorization: `Bearer ${signAccessToken({ _id: "000000000000000000000001" })}`,
        },
      })
    ).status,
    401,
  );
  const token = jwt.sign(
    { typ: "admin-access", email: "admin@example.com" },
    adminEnv.jwtSecret,
    { issuer: "zyrava-admin", audience: "zyrava-admin-web", expiresIn: "1h" },
  );
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amountRupees: 15,
      keyId: "rzp_test_newvalid",
      keySecret: "new-test-secret-value",
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.amount, 1500);
  assert.equal(body.keyId, "rzp_test_newvalid");
  assert.ok(!JSON.stringify(body).includes("new-test-secret-value"));
  const get = await fetch(url, { headers });
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.ok(!JSON.stringify(await get.json()).includes("credentials"));
});
