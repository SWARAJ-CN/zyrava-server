import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { REDIRECT, authorization, validState, exchangeCode, renderSettings } from "../scripts/setup-gmail.js";

test("Gmail setup binds the loopback callback to a unique state and PKCE verifier", () => {
  const flow = authorization("test-client");
  const url = new URL(flow.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.send");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(flow.verifier).digest("base64url"));
  assert.ok(validState(flow.state, flow.state));
  assert.ok(!validState(null, flow.state));
  assert.ok(!validState(authorization("test-client").state, flow.state));
  assert.ok(!flow.url.includes(flow.verifier));
});

test("setup exchanges authorization through Google only and refuses missing sending permission", async () => {
  const client = { client_id: "test-id", client_secret: "private-test-secret" };
  const refresh = await exchangeCode(client, "one-time-code", "test-verifier", async (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.body.get("code_verifier"), "test-verifier");
    assert.equal(init.body.get("client_secret"), client.client_secret);
    return { ok: true, json: async () => ({ refresh_token: "private-refresh", scope: "https://www.googleapis.com/auth/gmail.send" }) };
  });
  assert.equal(refresh, "private-refresh");
  await assert.rejects(exchangeCode(client, "code", "verifier", async () => ({ ok: true, json: async () => ({ refresh_token: "secret", scope: "openid" }) })), /sending permission/);
  await assert.rejects(exchangeCode(client, "code", "verifier", async () => ({ ok: false, json: async () => ({ error_description: "private-provider-detail" }) })), error => !error.message.includes("private-provider-detail"));
});

test("generated Render configuration uses Gmail HTTPS and cannot inject environment keys", () => {
  const text = renderSettings({ client_id: "test-id", client_secret: "test-secret" }, "test-refresh");
  const values = dotenv.parse(text);
  assert.equal(values.EMAIL_PROVIDER, "gmail");
  assert.equal(values.GMAIL_REFRESH_TOKEN, "test-refresh");
  assert.equal(values.ADMIN_NOTIFICATION_EMAIL, "zyrava00@gmail.com");
  assert.throws(() => renderSettings({ client_id: "test-id", client_secret: "secret\nEMAIL_OTP_ENABLED=false" }, "test-refresh"));
});
