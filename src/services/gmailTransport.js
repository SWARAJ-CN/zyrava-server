import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const mime = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
const failure = reason => Object.assign(new Error("Gmail API request failed"), { mailReason: reason });
let cachedToken;
let refreshInFlight;

export async function gmailAccessToken() {
  if (!env.gmailUser || !env.gmailClientId || !env.gmailClientSecret || !env.gmailRefreshToken) throw failure("missing_configuration");
  const credentials = [env.gmailClientId, env.gmailClientSecret, env.gmailRefreshToken].join("\n");
  if (cachedToken?.credentials === credentials && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  if (refreshInFlight?.credentials === credentials) return refreshInFlight.promise;
  const operation = { credentials };
  operation.promise = (async () => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.gmailClientId, client_secret: env.gmailClientSecret, refresh_token: env.gmailRefreshToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw failure(response.status === 429 ? "rate_limited" : response.status >= 500 ? "network_error" : "gmail_authorization");
    cachedToken = { credentials, token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
    return cachedToken.token;
  })();
  refreshInFlight = operation;
  try { return await operation.promise; }
  finally { if (refreshInFlight === operation) refreshInFlight = null; }
}

export async function sendGmailEmail(email, message) {
  const token = await gmailAccessToken();
  // Nodemailer builds the same MIME/inline logo as SMTP, then HTTPS transports it.
  const compiled = await mime.sendMail({ ...message, from: { name: "ZYRAVA", address: env.gmailUser }, to: email });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: compiled.message.toString("base64url") }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reasons = (result.error?.errors || []).map(item => item.reason);
    if (response.status === 401) cachedToken = null;
    throw failure(response.status === 429 || reasons.some(reason => /limit|quota/i.test(reason)) ? "rate_limited"
      : response.status === 401 ? "gmail_authorization" : response.status === 403 ? "gmail_permission" : "provider_rejected");
  }
  if (!result.id) throw failure("provider_rejected");
}
