import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
// Old deployed mail settings must no longer change sign-in behavior.
process.env.EMAIL_OTP_ENABLED = "true";
process.env.EMAIL_PROVIDER = "unavailable-provider";
process.env.JWT_ACCESS_SECRET = "password-auth-test-access-secret";
process.env.JWT_REFRESH_SECRET = "password-auth-test-refresh-secret";
process.env.MONGO_URI = "mongodb://127.0.0.1/unused-test-db";
const { User } = await import("../src/models/User.js");
const { Session } = await import("../src/models/Session.js");
const auth = await import("../src/services/authService.js");
const { validateAccessSession } = await import("../src/middleware/auth.js");
const { signAccessToken, hashToken } = await import("../src/utils/tokens.js");
const { authRoutes } = await import("../src/routes/authRoutes.js");
const passwordHash = await bcrypt.hash("password123", 4);
const meta = { ip: "127.0.0.1", userAgent: "test" };
function fixture(t) {
  const users = [
    { _id: "111111111111111111111111", email: "listener@example.com", passwordHash, authVersion: 0 },
    { _id: "222222222222222222222222", phone: "+919876543210", passwordHash, authVersion: 0 },
  ];
  const sessions = [];
  const query = value => ({ select: () => query(value), lean: async () => value, then: (ok, fail) => Promise.resolve(value).then(ok, fail) });
  t.mock.method(User, "findOne", filter => query(users.find(user => Object.entries(filter).every(([key, value]) => user[key] === value))));
  t.mock.method(User, "findById", id => query(users.find(user => user._id === String(id))));
  t.mock.method(User, "exists", async filter => users.some(user => filter.$or.some(part => Object.entries(part).every(([key, value]) => user[key] === value))));
  t.mock.method(User, "create", async input => { const user = { ...input, _id: String(users.length + 1).padStart(24, "0"), authVersion: 0 }; users.push(user); return user; });
  t.mock.method(User, "updateOne", async (filter, update) => { Object.assign(users.find(user => user._id === filter._id), update.$set); return { modifiedCount: 1 }; });
  t.mock.method(Session, "create", async value => { sessions.push(value); return value; });
  t.mock.method(Session, "findOneAndDelete", async filter => { const i = sessions.findIndex(session => session.tokenHash === filter.tokenHash); return i < 0 ? null : sessions.splice(i, 1)[0]; });
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Authentication must not call an external mail API"); });
  return { users, sessions, network };
}

test("email and phone login immediately issue sessions without email service access", async t => {
  const f = fixture(t);
  for (const identifier of ["LISTENER@example.com", "+91 98765 43210"]) {
    const result = await auth.loginAccount({ identifier, password: "password123", remember: true }, meta);
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(result.requiresOtp, undefined);
    assert.equal((await validateAccessSession(result.accessToken)).sub, result.user.id);
    assert.ok(result.expiresAt.getTime() > Date.now() + 29 * 86400000);
  }
  assert.equal(f.sessions.length, 2);
  assert.equal(f.network.mock.callCount(), 0);
});

test("new email and phone accounts sign in immediately; duplicate registrations stay rejected", async t => {
  const f = fixture(t);
  for (const contact of [{ email: "new@example.com" }, { phone: "+919999999999" }]) {
    const result = await auth.registerAccount({ ...contact, name: "New listener", password: "password123", remember: false }, meta);
    assert.ok(result.accessToken);
    assert.equal(result.requiresOtp, undefined);
    assert.equal(result.user.passwordHash, undefined);
    assert.ok(await bcrypt.compare("password123", f.users.at(-1).passwordHash));
    await assert.rejects(auth.registerAccount({ ...contact, password: "password123" }, meta), e => e.status === 409);
  }
  assert.equal(f.network.mock.callCount(), 0);
});

test("invalid passwords and unknown accounts still fail without creating sessions", async t => {
  const f = fixture(t);
  for (const input of [{ identifier: "listener@example.com", password: "wrong" }, { identifier: "unknown@example.com", password: "password123" }]) {
    await assert.rejects(auth.loginAccount(input, meta), e => e.status === 401);
  }
  assert.equal(f.sessions.length, 0);
  assert.equal(f.network.mock.callCount(), 0);
});

test("existing sessions rotate without OTP markers while revoked session versions remain invalid", async t => {
  const f = fixture(t);
  f.sessions.push({ user: f.users[0]._id, tokenHash: hashToken("legacy-session"), expiresAt: new Date(Date.now() + 60000), remember: false });
  const result = await auth.rotateSession("legacy-session", meta);
  assert.ok(result.accessToken);
  await assert.rejects(auth.rotateSession("legacy-session", meta), e => e.status === 401);
  const access = signAccessToken(f.users[0]);
  f.users[0].authVersion = 1;
  await assert.rejects(validateAccessSession(access), e => e.status === 401);
  await assert.rejects(auth.rotateSession(result.refreshToken, meta), e => e.status === 401);
});

test("retired email verification and recovery endpoints no longer exist", async t => {
  const app = express(); app.use("/auth", authRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of ["/email/verify", "/email/resend", "/password/request", "/password/verify", "/password/reset"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth${path}`, { method: "POST" });
    assert.equal(response.status, 404);
  }
});
