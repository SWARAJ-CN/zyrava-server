import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
process.env.EMAIL_OTP_ENABLED = "true";
process.env.SMTP_USER = "test@example.com";
process.env.SMTP_PASSWORD = "test-only-password";
process.env.JWT_ACCESS_SECRET = "test-access-secret-not-used-outside-tests";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-not-used-outside-tests";
process.env.MONGO_URI = "mongodb://127.0.0.1/unused-test-db";
const { User } = await import("../src/models/User.js");
const { Session } = await import("../src/models/Session.js");
const { EmailChallenge } = await import("../src/models/EmailChallenge.js");
const otp = await import("../src/services/emailOtpService.js");
const auth = await import("../src/services/authService.js");
const { mailTransport, otpEmail } = await import("../src/services/emailService.js");
const { signAccessToken, hashToken } = await import("../src/utils/tokens.js");
const { validateAccessSession } = await import("../src/middleware/auth.js");
const { prepareEmailAuthentication } = await import("../src/services/emailAuthRollout.js");
const passwordHash = await bcrypt.hash("password123", 4);
const copy = (v) => v == null ? v : structuredClone(v);
function matches(item, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = item[key];
    if (value === null) return actual == null;
    if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, expected]) => {
      if (op === "$lt") return actual < expected;
      if (op === "$lte") return actual <= expected;
      if (op === "$gt") return actual > expected;
      if (op === "$ne") return expected === null ? actual != null : actual !== expected;
      if (op === "$in") return expected.includes(actual);
      if (op === "$type") return typeof actual === expected;
      throw new Error(`unsupported filter ${op}`);
    });
    return String(actual) === String(value);
  });
}
function update(item, change) {
  Object.assign(item, change.$set ?? {});
  for (const [key, n] of Object.entries(change.$inc ?? {})) item[key] = (item[key] ?? 0) + n;
  for (const key of Object.keys(change.$unset ?? {})) delete item[key];
}
function harness(t) {
  const email = { _id: "email-user", email: "person@example.com", passwordHash, authVersion: 0 };
  const phone = { _id: "phone-user", phone: "+919876543210", passwordHash, authVersion: 0 };
  const users = [email, phone], challenges = [], sessions = [], messages = [];
  const query = (value) => ({ select: () => query(value), lean: async () => copy(value), then: (ok, fail) => Promise.resolve(copy(value)).then(ok, fail) });
  t.mock.method(User, "findOne", filter => query(users.find(u => matches(u, filter)) ?? null));
  t.mock.method(User, "findById", id => query(users.find(u => u._id === String(id)) ?? null));
  t.mock.method(User, "updateOne", async (filter, change) => { const u = users.find(u => matches(u, filter)); if (!u) return { modifiedCount: 0 }; update(u, change); return { modifiedCount: 1 }; });
  t.mock.method(EmailChallenge, "findOneAndUpdate", async (filter, change, options = {}) => {
    let item = challenges.find(c => matches(c, filter));
    if (!item && options.upsert) {
      if (challenges.some(c => c.user === filter.user && c.purpose === filter.purpose)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      item = { _id: `challenge-${challenges.length}`, user: filter.user, purpose: filter.purpose };
      challenges.push(item);
    }
    if (!item) return null;
    update(item, change); return copy(item);
  });
  t.mock.method(EmailChallenge, "findOne", async filter => copy(challenges.find(c => matches(c, filter)) ?? null));
  t.mock.method(EmailChallenge, "findOneAndDelete", async filter => { const i = challenges.findIndex(c => matches(c, filter)); return i < 0 ? null : challenges.splice(i, 1)[0]; });
  t.mock.method(EmailChallenge, "deleteOne", async filter => { const i = challenges.findIndex(c => matches(c, filter)); if (i >= 0) challenges.splice(i, 1); });
  t.mock.method(EmailChallenge, "deleteMany", async filter => { for (let i = challenges.length - 1; i >= 0; i--) if (matches(challenges[i], filter)) challenges.splice(i, 1); });
  t.mock.method(Session, "create", async item => sessions.push(copy(item)));
  t.mock.method(Session, "findOneAndDelete", async filter => { const i = sessions.findIndex(s => matches(s, filter)); return i < 0 ? null : sessions.splice(i, 1)[0]; });
  t.mock.method(Session, "deleteMany", async filter => { for (let i = sessions.length - 1; i >= 0; i--) if (matches(sessions[i], filter)) sessions.splice(i, 1); });
  t.mock.method(mailTransport(), "sendMail", async message => { messages.push(message); return {}; });
  const code = () => messages.at(-1).text.match(/: (\d{6})/)[1];
  return { email, phone, users, challenges, sessions, messages, code };
}
const meta = { ip: "127.0.0.1", userAgent: "test" };

test("email password login produces only an OTP challenge; verification issues a session once", async t => {
  const h = harness(t);
  const result = await auth.loginAccount({ identifier: h.email.email, password: "password123", remember: true }, meta);
  assert.equal(result.requiresOtp, true); assert.equal(result.accessToken, undefined); assert.equal(h.sessions.length, 0);
  assert.ok(!JSON.stringify(h.challenges).includes(h.code()));
  const input = { challengeId: result.challengeId, code: h.code() };
  const results = await Promise.allSettled([auth.completeEmailLogin(input, meta), auth.completeEmailLogin(input, meta)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(h.sessions.length, 1); assert.equal(h.sessions[0].emailOtpVerified, true); assert.equal(h.sessions[0].remember, true);
  await assert.rejects(auth.completeEmailLogin(input, meta), /incorrect or expired/);
});

test("wrong password never sends mail and five incorrect OTPs lock the challenge", async t => {
  const h = harness(t);
  await assert.rejects(auth.loginAccount({ identifier: h.email.email, password: "wrong" }, meta));
  assert.equal(h.messages.length, 0);
  const challenge = await otp.startEmailChallenge(h.email, "login");
  const good = h.code(), wrong = good === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(otp.verifyEmailChallenge(challenge.challengeId, wrong, "login"));
  await assert.rejects(otp.verifyEmailChallenge(challenge.challengeId, good, "login"));
});

test("OTP expiry, purpose binding and resend cooldown are enforced server-side", async t => {
  const h = harness(t);
  const challenge = await otp.startEmailChallenge(h.email, "login");
  await assert.rejects(otp.startEmailChallenge(h.email, "login"), e => e.status === 429);
  await assert.rejects(otp.resendEmailChallenge(challenge.challengeId, "login"), e => e.status === 429);
  await assert.rejects(otp.verifyEmailChallenge(challenge.challengeId, h.code(), "reset"));
  const oldHash = h.challenges[0].codeHash;
  h.challenges[0].sentAt = new Date(Date.now() - 61_000);
  await otp.resendEmailChallenge(challenge.challengeId, "login");
  assert.notEqual(h.challenges[0].codeHash, oldHash);
  h.challenges[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(otp.verifyEmailChallenge(challenge.challengeId, h.code(), "login"));
});

test("password reset requires a verified one-use grant and revokes all email sessions", async t => {
  const h = harness(t);
  h.sessions.push({ user: h.email._id }, { user: h.phone._id });
  const oldAccess = signAccessToken(h.email, true);
  const challenge = await otp.requestPasswordReset(h.email.email);
  await assert.rejects(otp.finishPasswordReset(challenge.challengeId, "newpassword123"));
  const { resetToken } = await otp.verifyEmailChallenge(challenge.challengeId, h.code(), "reset");
  await otp.finishPasswordReset(resetToken, "newpassword123");
  assert.ok(await bcrypt.compare("newpassword123", h.email.passwordHash));
  assert.equal(h.email.authVersion, 1); assert.deepEqual(h.sessions, [{ user: h.phone._id }]);
  await assert.rejects(otp.finishPasswordReset(resetToken, "another123"));
  await assert.rejects(validateAccessSession(oldAccess));
});

test("phone-only logins and legacy phone sessions survive while legacy email sessions fail", async t => {
  const h = harness(t);
  const phoneSession = await auth.loginAccount({ identifier: h.phone.phone, password: "password123", remember: false }, meta);
  assert.ok(phoneSession.accessToken); assert.equal(h.messages.length, 0);
  assert.equal((await validateAccessSession(signAccessToken(h.phone))).sub, h.phone._id);
  await assert.rejects(validateAccessSession(signAccessToken(h.email)));
  h.sessions.push({ user: h.email._id, tokenHash: hashToken("legacy-email"), expiresAt: new Date(Date.now() + 100000) });
  await assert.rejects(auth.rotateSession("legacy-email", meta));
  assert.ok((await auth.rotateSession(phoneSession.refreshToken, meta)).accessToken);
  await assert.rejects(otp.startEmailChallenge(h.phone, "reset"));
});

test("unknown reset email returns an opaque challenge without disclosing membership", async t => {
  const h = harness(t);
  const result = await otp.requestPasswordReset("missing@example.com");
  assert.equal(result.requiresOtp, true); assert.equal(result.challengeId.length, 64);
  assert.equal(h.messages.length, 0); assert.equal(h.challenges.length, 0);
});

test("rollout deletes only unverified email sessions and is safe to repeat", async t => {
  const h = harness(t);
  h.sessions.push({ user: h.email._id }, { user: h.email._id, emailOtpVerified: true }, { user: h.phone._id });
  t.mock.method(mailTransport(), "verify", async () => true);
  t.mock.method(EmailChallenge, "init", async () => {});
  t.mock.method(User, "find", filter => ({ select: () => ({ cursor: async function* () { for (const u of h.users) if (matches(u, filter)) yield u; } }) }));
  await prepareEmailAuthentication(); await prepareEmailAuthentication();
  assert.deepEqual(h.sessions, [{ user: h.email._id, emailOtpVerified: true }, { user: h.phone._id }]);
});

test("branded emails include an embedded logo, plaintext code and expiry", () => {
  const message = otpEmail("123456", "reset");
  assert.match(message.html, /cid:zyrava-logo/); assert.equal(message.attachments[0].cid, "zyrava-logo");
  assert.match(message.text, /123456/); assert.match(message.text, /10 minutes/);
});
