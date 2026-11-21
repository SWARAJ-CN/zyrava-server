import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET = "test-admin-email-access-secret";
process.env.JWT_REFRESH_SECRET = "test-admin-email-refresh-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1/unused-test-db";
process.env.SMTP_USER = "test@example.com";
process.env.SMTP_PASSWORD = "test-only-password";
process.env.EMAIL_PROVIDER = "smtp";
const { User } = await import("../src/models/User.js");
const { mailTransport } = await import("../src/services/emailService.js");
const { emailTemplates, adminEmailMessage, userEmailBody } = await import("../src/admin/services/userEmailService.js");
const { usersRoutes } = await import("../src/admin/routes/users.js");
const { requireAdmin } = await import("../src/admin/middleware/auth.js");
const { adminEnv } = await import("../src/admin/env.js");

test("personal templates and typed content are rendered as text, not executable HTML", () => {
  const templates = emailTemplates("A <script>alert(1)</script>");
  assert.equal(templates.length, 4);
  assert.deepEqual(templates.map(t => t.id), ["callback", "rare", "funny", "spam"]);
  for (const draft of templates) {
    const mail = adminEmailMessage(draft.subject, draft.message);
    assert.match(mail.html, /&lt;script&gt;/);
    assert.ok(!mail.html.includes("<script>"));
    assert.match(mail.html, /cid:zyrava-logo/);
    assert.equal(mail.attachments[0].cid, "zyrava-logo");
  }
  assert.match(adminEmailMessage("<img src=x>", "Hello\n<script>x</script>").html, /Hello<br>&lt;script&gt;/);
  const valid = { template: "custom", subject: "Hello", message: "A note" };
  assert.ok(userEmailBody.safeParse(valid).success);
  for (const invalid of [{ ...valid, to: "other@example.com" }, { ...valid, subject: "Hi\r\nBcc: x@y.com" }, { ...valid, message: " " }, { ...valid, message: "x".repeat(5001) }, { ...valid, template: "unknown" }]) {
    assert.equal(userEmailBody.safeParse(invalid).success, false);
  }
});

test("admin email API enforces authorization, recipient binding, validation and delivery failures", async t => {
  Object.assign(adminEnv, { configured: true, jwtSecret: "admin-email-test-secret" });
  const emailId = "111111111111111111111111", phoneId = "222222222222222222222222", failedId = "333333333333333333333333";
  t.mock.method(User, "findById", id => ({
    select(fields) {
      assert.equal(fields, "name email");
      return { lean: async () => id === emailId ? { name: "Listener", email: "recipient@example.com" } : id === phoneId ? { name: "Phone listener" } : id === failedId ? { email: "failure@example.com" } : null };
    },
  }));
  const messages = [];
  t.mock.method(mailTransport(), "sendMail", async message => {
    if (message.to === "failure@example.com") throw new Error("sensitive provider error");
    messages.push(message);
    return { messageId: "test-message" };
  });
  const app = express();
  app.use(express.json());
  app.use("/users", requireAdmin, usersRoutes);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/users`;
  const token = jwt.sign({ typ: "admin-access", email: "admin@example.com" }, adminEnv.jwtSecret, { issuer: "zyrava-admin", audience: "zyrava-admin-web", expiresIn: "1m" });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const draft = { template: "funny", subject: "Edited subject", message: "Hi Listener,\nHere is my own message." };
  const post = (id, body = draft) => fetch(`${base}/${id}/email`, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/${emailId}/email/templates`)).status, 401);
  assert.equal((await fetch(`${base}/${emailId}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })).status, 401);
  const userToken = jwt.sign({ typ: "access" }, adminEnv.jwtSecret);
  assert.equal((await fetch(`${base}/${emailId}/email/templates`, { headers: { Authorization: `Bearer ${userToken}` } })).status, 401);
  const templateResponse = await fetch(`${base}/${emailId}/email/templates`, { headers });
  assert.equal(templateResponse.status, 200);
  assert.equal(templateResponse.headers.get("cache-control"), "no-store");
  const result = await templateResponse.json();
  assert.equal(result.templates.length, 4);
  assert.equal(result.recipient.email, "recipient@example.com");
  assert.equal(messages.length, 0);
  assert.equal((await post("invalid")).status, 422);
  assert.equal((await post(emailId, { ...draft, to: "attacker@example.com" })).status, 422);
  assert.equal((await post(emailId, { ...draft, message: "" })).status, 422);
  assert.equal((await post(phoneId)).status, 422);
  assert.equal((await post("444444444444444444444444")).status, 404);
  const failed = await post(failedId);
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("sensitive provider"));
  const sent = await post(emailId);
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).accepted, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "recipient@example.com");
  assert.equal(messages[0].subject, draft.subject);
  assert.match(messages[0].text, /Here is my own message/);
  assert.equal((await post(emailId)).status, 429);
  assert.equal(messages.length, 1);
});
