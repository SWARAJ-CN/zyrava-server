import { env } from "../config/env.js";

let lastFailure = null;
let lastAcceptedAt = null;
const hints = {
  missing_configuration: "Add the required mail environment variables to this deployed server, then redeploy.",
  invalid_provider: "Set EMAIL_PROVIDER to smtp, gmail or resend.",
  gmail_authorization: "Gmail OAuth authorization is missing, expired or revoked. Re-authorize the sender and update GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN.",
  gmail_permission: "Enable Gmail API in the OAuth project's Google Cloud console and authorize the sender with the gmail.send scope. Check Gmail sending restrictions too.",
  smtp_authentication: "Check SMTP_USER and the Gmail app password in Render's environment.",
  smtp_connection: "SMTP could not connect. Render Free blocks ports 25, 465 and 587; use Gmail API over HTTPS, Resend HTTPS with a verified sender domain, or SMTP-capable hosting.",
  api_authentication: "Check that RESEND_API_KEY is active and has permission to send from this domain.",
  sender_not_verified: "Verify the sender domain in Resend and set EMAIL_FROM to an address on that domain. Gmail is not a domain you own.",
  testing_only: "Resend's testing sender cannot email arbitrary users. Set EMAIL_FROM to an address on your verified domain.",
  rate_limited: "The provider's rate or sending quota was reached. Check usage in the mail provider dashboard.",
  provider_rejected: "The provider rejected this email. Check the sender/domain and sending permissions in the provider dashboard.",
  network_error: "The mail provider could not be reached. Check outbound HTTPS access and provider availability.",
  delivery_error: "Mail delivery failed. Check the configured sender and the provider dashboard.",
};

export function recordEmailFailure(error) {
  let code = error.mailReason;
  if (!hints[code]) {
    if (env.emailProvider === "smtp" && error.code === "EAUTH") code = "smtp_authentication";
    else if (env.emailProvider === "smtp" && ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNREFUSED", "EDNS"].includes(error.code)) code = "smtp_connection";
    else if (["AbortError", "TimeoutError", "TypeError"].includes(error.name)) code = "network_error";
    else code = "delivery_error";
  }
  lastFailure = { code, hint: hints[code], at: new Date().toISOString() };
  // Never print raw error bodies, credentials, recipient addresses, or OTPs.
  console.warn(`[zyrava] email delivery failed (${code}): ${hints[code]}`);
  return code;
}

export function recordEmailAccepted() { lastAcceptedAt = new Date().toISOString(); }

export function emailDiagnostics() {
  const provider = ["smtp", "gmail", "resend"].includes(env.emailProvider) ? env.emailProvider : "invalid";
  const missing = provider === "gmail"
    ? [!env.gmailUser && "GMAIL_USER", !env.gmailClientId && "GMAIL_CLIENT_ID", !env.gmailClientSecret && "GMAIL_CLIENT_SECRET", !env.gmailRefreshToken && "GMAIL_REFRESH_TOKEN"].filter(Boolean)
    : provider === "resend"
    ? [!env.resendApiKey && "RESEND_API_KEY", !env.emailFrom && "EMAIL_FROM"].filter(Boolean)
    : provider === "smtp" ? [!env.smtpUser && "SMTP_USER", !env.smtpPassword && "SMTP_PASSWORD"].filter(Boolean) : ["EMAIL_PROVIDER"];
  const warnings = [];
  if (provider === "smtp" && process.env.RENDER === "true" && [25, 465, 587].includes(env.smtpPort)) warnings.push("Render Free blocks this SMTP port. Use EMAIL_PROVIDER=gmail with Gmail OAuth credentials, Resend HTTPS with a verified sender domain, or move to SMTP-capable hosting.");
  if (provider === "resend" && /@(gmail\.com|googlemail\.com)(>|$)/i.test(env.emailFrom || "")) warnings.push("Resend needs your own verified sender domain; EMAIL_FROM cannot use gmail.com.");
  if (missing.length) warnings.push(`Missing environment variables: ${missing.join(", ")}.`);
  return { provider, configured: missing.length === 0, missing, warnings, lastFailure, lastAcceptedAt,
    status: missing.length ? "Configuration incomplete" : lastFailure && (!lastAcceptedAt || lastFailure.at >= lastAcceptedAt) ? "Last delivery failed" : lastAcceptedAt ? "Provider accepted mail" : "Delivery not tested",
    adminNotifications: env.adminAuthEmailsEnabled, adminNotificationEmail: env.adminNotificationEmail };
}
