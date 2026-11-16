import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { CustomizationPurchase } from "../src/models/CustomizationPurchase.js";
import { readPaymentHistory } from "../src/services/paymentHistoryService.js";
import { customizationRoutes } from "../src/routes/customizationRoutes.js";
import { usersRoutes } from "../src/admin/routes/users.js";
import { requireAdmin } from "../src/admin/middleware/auth.js";
import { adminEnv } from "../src/admin/env.js";
import { signAccessToken } from "../src/utils/tokens.js";
import { database } from "./helpers/customizationDatabase.js";
const a = "000000000000000000000001",
  b = "000000000000000000000002",
  reserved = "000000000000000000000003";
function fixture(t) {
  const { users } = database(t);
  const statuses = [
    "created",
    "authorized",
    "captured",
    "failed",
    "order_failed",
    "refunded",
    "partially_refunded",
  ];
  const rows = statuses.map((paymentStatus, index) => ({
    _id: String(index + 10).padStart(24, "0"),
    user: a,
    recipient: index % 2 ? users[1] : users[0],
    config: {
      title: `Design ${index}`,
      durationMinutes: 60,
      loadingMessage: "private config",
    },
    amount: 500 + index * 100,
    currency: "INR",
    paymentStatus,
    status: index > 3 ? "fulfilled" : "pending",
    createdAt: new Date(2026, 0, index + 1),
    orderId: `order_${index}`,
    lastPaymentId: `pay_${index}`,
    amountRefunded: index === 5 ? 1000 : index === 6 ? 100 : 0,
    keyId: "private-key",
    credentialId: "private-credential",
    requestId: "private-request",
  }));
  rows.push({
    ...rows[0],
    _id: "000000000000000000000099",
    user: b,
    recipient: users[0],
    purpose: "customization_gift",
  });
  t.mock.method(
    CustomizationPurchase,
    "countDocuments",
    async (filter) => rows.filter((p) => p.user === filter.user).length,
  );
  t.mock.method(CustomizationPurchase, "find", (filter) => {
    let selected = rows.filter((p) => p.user === filter.user),
      skip = 0,
      limit = 10;
    return {
      select() {
        return this;
      },
      sort(order) {
        assert.deepEqual(order, { createdAt: -1, _id: -1 });
        selected.sort(
          (a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id),
        );
        return this;
      },
      skip(value) {
        skip = value;
        return this;
      },
      limit(value) {
        limit = value;
        return this;
      },
      populate(path, fields) {
        assert.equal(path, "recipient");
        assert.equal(fields, "name email phone");
        return this;
      },
      async lean() {
        return selected.slice(skip, skip + limit);
      },
    };
  });
  return rows;
}

test("history includes every status, frozen amounts, purposes and refunds without exposing private fields", async (t) => {
  fixture(t);
  const result = await readPaymentHistory(a);
  assert.equal(result.total, 7);
  assert.deepEqual(
    result.items.map((p) => p.amount),
    [1100, 1000, 900, 800, 700, 600, 500],
  );
  assert.deepEqual(
    result.items.map((p) => p.paymentStatus),
    [
      "partially_refunded",
      "refunded",
      "order_failed",
      "failed",
      "captured",
      "authorized",
      "created",
    ],
  );
  assert.equal(result.items[0].purpose, "customization_self");
  assert.equal(result.items[1].purpose, "customization_gift");
  assert.equal(result.items[1].recipient.name, "Recipient");
  assert.equal(result.items[1].recipient.phone, "•••• 210");
  assert.equal(result.items[1].amountRefunded, 1000);
  assert.equal(result.items[1].paymentId, "pay_5");
  for (const privateValue of [
    "recipient@example.com",
    "creator@example.com",
    "9876543210",
    "private-key",
    "private-credential",
    "private-request",
    "private config",
    '"config"',
  ]) {
    assert.ok(!JSON.stringify(result).includes(privateValue), privateValue);
  }
  const recipientHistory = await readPaymentHistory(b);
  assert.equal(
    recipientHistory.total,
    1,
    "received gifts do not become recipient charges",
  );
  assert.equal(recipientHistory.items[0].id, "000000000000000000000099");
});

test("history paginates consistently and preserves the reason after recipient removal", async (t) => {
  const rows = fixture(t);
  rows[6].recipient = null;
  rows[6].purpose = "customization_gift";
  const first = await readPaymentHistory(a, { page: 1, limit: 3 });
  const second = await readPaymentHistory(a, { page: 2, limit: 3 });
  assert.equal(first.pages, 3);
  assert.equal(first.items[0].recipient, null);
  assert.equal(first.items[0].purpose, "customization_gift");
  assert.equal(second.items.length, 3);
  assert.ok(
    second.items.every((p) => !first.items.some((other) => other.id === p.id)),
  );
  const empty = await readPaymentHistory(reserved);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
});

test("user and admin history routes enforce ownership, authentication, masking and strict pagination", async (t) => {
  fixture(t);
  const before = {
    configured: adminEnv.configured,
    jwtSecret: adminEnv.jwtSecret,
  };
  Object.assign(adminEnv, {
    configured: true,
    jwtSecret: "history-test-only-admin-secret",
  });
  t.after(() => Object.assign(adminEnv, before));
  const app = express();
  app.use(express.json());
  app.use("/api/customization", customizationRoutes);
  app.use("/api/admin/users", requireAdmin, usersRoutes);
  app.use((err, req, res, next) =>
    res.status(err.status ?? 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = "/api/customization/payments/history";
  const headers = { Authorization: `Bearer ${signAccessToken({ _id: a })}` };
  assert.equal((await fetch(base + path)).status, 401);
  const response = await fetch(base + path + "?page=2&limit=3", { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).total, 7);
  for (const query of [
    `userId=${b}`,
    "page=0",
    "page=1.5",
    "limit=51",
    "limit=-1",
  ]) {
    assert.equal(
      (await fetch(base + path + "?" + query, { headers })).status,
      422,
    );
  }
  assert.equal(
    (
      await fetch(base + path, {
        headers: {
          Authorization: `Bearer ${signAccessToken({ _id: reserved })}`,
        },
      })
    ).status,
    403,
  );
  const adminPath = `/api/admin/users/${b}/payments`;
  assert.equal((await fetch(base + adminPath, { headers })).status, 401);
  const token = jwt.sign(
    { typ: "admin-access", email: "admin@example.com" },
    adminEnv.jwtSecret,
    { issuer: "zyrava-admin", audience: "zyrava-admin-web", expiresIn: "1m" },
  );
  const adminHeaders = { Authorization: `Bearer ${token}` };
  const adminResponse = await fetch(base + adminPath, {
    headers: adminHeaders,
  });
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "no-store");
  assert.equal((await adminResponse.json()).total, 1);
  assert.equal(
    (
      await fetch(base + "/api/admin/users/invalid/payments", {
        headers: adminHeaders,
      })
    ).status,
    422,
  );
});
