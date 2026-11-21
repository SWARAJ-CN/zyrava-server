import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.JWT_ACCESS_SECRET = "test-notification-access-secret";
process.env.JWT_REFRESH_SECRET = "test-notification-refresh-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1/unused-test-db";
process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-only-resend-key";
process.env.EMAIL_FROM = "ZYRAVA <auth@example.com>";
process.env.ADMIN_AUTH_EMAILS_ENABLED = "true";
process.env.ADMIN_NOTIFICATION_EMAIL = "zyrava00@gmail.com";
const { env } = await import("../src/config/env.js");
const { AdminAuthEmail } = await import("../src/models/AdminAuthEmail.js");
const { adminAuthMessage, deliverNextAdminAuthEmail, queueAdminAuthEmail } = await import("../src/services/adminAuthEmailService.js");
const { emailDiagnostics } = await import("../src/services/emailDiagnostics.js");
const { sendEmail } = await import("../src/services/emailService.js");

function cast(filter) {
  const query = new mongoose.Query(filter, {}, AdminAuthEmail, AdminAuthEmail.collection);
  query.setOptions({ sanitizeFilter: true, strictQuery: true });
  query._castConditions();
  assert.ifError(query.error());
}
function job() {
  return { _id: "111111111111111111111111", user: "222222222222222222222222", recipient: "zyrava00@gmail.com", event: "login", name: "Listener", phone: "+919876543210", occurredAt: new Date("2026-11-21T00:00:00Z"), status: "pending", attempts: 0 };
}
function worker(t, item) {
  t.mock.method(AdminAuthEmail, "findOneAndUpdate", async (filter, update) => {
    cast(filter);
    if (item.status !== "pending") return null;
    Object.assign(item, update.$set);
    item.attempts += update.$inc.attempts;
    return item;
  });
  t.mock.method(AdminAuthEmail, "updateOne", async (filter, update) => {
    assert.equal(filter.leaseId, item.leaseId);
    assert.equal(filter.status, "sending");
    Object.assign(item, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete item[key];
  });
}

test("queued notifications include only authorized account details and the fixed admin destination", async t => {
  let stored;
  t.mock.method(AdminAuthEmail, "create", async row => { stored = row; });
  await queueAdminAuthEmail({ _id: "222222222222222222222222", name: "Listener", email: "listener@example.com", passwordHash: "private-password-hash", accessToken: "private-token" }, "registration");
  assert.equal(stored.recipient, "zyrava00@gmail.com");
  assert.equal(stored.event, "registration");
  assert.equal(stored.email, "listener@example.com");
  assert.ok(!JSON.stringify(stored).includes("private"));
  assert.ok(stored.expiresAt > stored.occurredAt);
  assert.match(adminAuthMessage(stored).subject, /New user joined/);
  const before = env.adminAuthEmailsEnabled;
  env.adminAuthEmailsEnabled = false;
  t.after(() => { env.adminAuthEmailsEnabled = before; });
  stored = null;
  await queueAdminAuthEmail({ _id: "222222222222222222222222" }, "login");
  assert.equal(stored, null);
});

test("worker sends phone login notices without attachments over HTTPS and uses a stable retry key", async t => {
  const item = job();
  worker(t, item);
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers["Idempotency-Key"], `admin-auth-${item._id}`);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ["zyrava00@gmail.com"]);
    assert.deepEqual(body.attachments, []);
    assert.match(body.text, /\+919876543210/);
    assert.match(body.text, /phone account/);
    return { ok: true, json: async () => ({ id: "notification-mail" }) };
  });
  await Promise.all([deliverNextAdminAuthEmail(), deliverNextAdminAuthEmail()]);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(item.status, "accepted");
  assert.ok(item.acceptedAt);
});

test("delivery failures schedule bounded retries and keep raw provider details out of the queue", async t => {
  const item = job();
  worker(t, item);
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401, json: async () => ({ message: "API key private-secret invalid", name: "validation_error" }) }));
  await deliverNextAdminAuthEmail();
  assert.equal(item.status, "pending");
  assert.equal(item.lastError, "api_authentication");
  assert.ok(item.nextAttemptAt > new Date());
  assert.ok(!JSON.stringify(item).includes("private-secret"));
  item.attempts = 5;
  await deliverNextAdminAuthEmail();
  assert.equal(item.status, "failed");
});

test("diagnostics classify Resend errors without leaking provider bodies, recipients, or secrets", async t => {
  const logs = [];
  t.mock.method(console, "warn", value => logs.push(value));
  const cases = [
    [401, "API key private-secret is invalid", "api_authentication"],
    [403, "The secret-domain.example domain is not verified", "sender_not_verified"],
    [403, "You can only send testing emails to private@example.com", "testing_only"],
    [429, "quota reached for private@example.com", "rate_limited"],
  ];
  for (const [status, message, code] of cases) {
    const request = t.mock.method(globalThis, "fetch", async () => ({ ok: false, status, json: async () => ({ message }) }));
    await assert.rejects(sendEmail("private@example.com", { subject: "Test", text: "123456-secret" }), error => error.status === 503 && error.mailCode === code);
    assert.equal(emailDiagnostics().lastFailure.code, code);
    request.mock.restore();
  }
  const diagnostics = JSON.stringify(emailDiagnostics()) + logs.join("\n");
  for (const privateValue of ["private@example.com", "private-secret", "secret-domain", "123456-secret", env.resendApiKey]) assert.ok(!diagnostics.includes(privateValue));
});
