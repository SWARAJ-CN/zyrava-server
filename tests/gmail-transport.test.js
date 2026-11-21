import test from "node:test";
import assert from "node:assert/strict";
process.env.JWT_ACCESS_SECRET = "gmail-test-access-secret";
process.env.JWT_REFRESH_SECRET = "gmail-test-refresh-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1/unused-test-db";
process.env.EMAIL_PROVIDER = "gmail";
process.env.GMAIL_USER = "sender@gmail.com";
process.env.GMAIL_CLIENT_ID = "test-client-id";
process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
const { env } = await import("../src/config/env.js");
const { sendOtpEmail, sendEmail } = await import("../src/services/emailService.js");
const { emailDiagnostics } = await import("../src/services/emailDiagnostics.js");

test("Gmail API shares token refresh across concurrent sends and preserves OTP MIME and logo", async t => {
  let refreshes = 0, sends = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      refreshes++;
      assert.equal(options.body.get("grant_type"), "refresh_token");
      assert.equal(options.body.get("refresh_token"), "test-refresh-token");
      assert.equal(options.body.get("client_secret"), "test-client-secret");
      return { ok: true, json: async () => ({ access_token: "test-access-token", expires_in: 3600 }) };
    }
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    sends++;
    assert.equal(options.headers.Authorization, "Bearer test-access-token");
    assert.ok(options.signal instanceof AbortSignal);
    const { raw } = JSON.parse(options.body);
    assert.match(raw, /^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(mime, /From: ZYRAVA <sender@gmail.com>/);
    assert.match(mime, /To: recipient@example.com/);
    assert.match(mime, /123456/);
    assert.match(mime, /Content-ID: <zyrava-logo>/);
    assert.ok(!mime.includes("test-client-secret"));
    return { ok: true, json: async () => ({ id: `mail-${sends}` }) };
  });
  await Promise.all([sendOtpEmail("recipient@example.com", "123456", "login"), sendOtpEmail("recipient@example.com", "123456", "reset")]);
  assert.equal(refreshes, 1);
  assert.equal(sends, 2);
});

test("revoked Gmail OAuth does not fall back to SMTP or reveal tokens", async t => {
  const previous = env.gmailRefreshToken;
  env.gmailRefreshToken = "revoked-refresh-token";
  t.after(() => { env.gmailRefreshToken = previous; });
  const request = t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    return { ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "private-token-details" }) };
  });
  await assert.rejects(sendEmail("recipient@example.com", { subject: "Test", text: "Hello" }), error => error.status === 503 && error.mailCode === "gmail_authorization" && !error.message.includes("private"));
  assert.equal(request.mock.callCount(), 1);
  assert.equal(emailDiagnostics().lastFailure.code, "gmail_authorization");
  assert.ok(!JSON.stringify(emailDiagnostics()).includes("revoked-refresh-token"));
});

test("Gmail quota and permission failures are actionable in admin diagnostics", async t => {
  const previous = env.gmailRefreshToken;
  env.gmailRefreshToken = "permission-test-token";
  t.after(() => { env.gmailRefreshToken = previous; });
  for (const [reason, code] of [["accessNotConfigured", "gmail_permission"], ["userRateLimitExceeded", "rate_limited"]]) {
    const request = t.mock.method(globalThis, "fetch", async url => url.includes("oauth2.googleapis.com")
      ? { ok: true, json: async () => ({ access_token: "test-access-token", expires_in: 3600 }) }
      : { ok: false, status: 403, json: async () => ({ error: { errors: [{ reason }] } }) });
    await assert.rejects(sendEmail("recipient@example.com", { subject: "Test", text: "Hello" }), error => error.mailCode === code);
    assert.equal(emailDiagnostics().lastFailure.code, code);
    request.mock.restore();
  }
});
