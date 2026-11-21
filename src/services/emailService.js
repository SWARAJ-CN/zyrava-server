import nodemailer from "nodemailer";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { AppError } from "../utils/http.js";
import { recordEmailFailure, recordEmailAccepted } from "./emailDiagnostics.js";
import { sendGmailEmail } from "./gmailTransport.js";

function deliveryError(reason) { return Object.assign(new Error("Email delivery failed"), { mailReason: reason }); }

let transport;
export function mailTransport() {
  if (!env.smtpUser || !env.smtpPassword) throw deliveryError("missing_configuration");
  transport ??= nodemailer.createTransport({
    host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
    requireTLS: true, auth: { user: env.smtpUser, pass: env.smtpPassword },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    logger: false, debug: false,
  });
  return transport;
}

export function otpEmail(code, purpose) {
  const reset = purpose === "reset";
  const title = reset ? "Reset your password" : "Your music is one step away";
  const action = reset ? "reset your ZYRAVA password" : "finish signing in to ZYRAVA";
  return {
    subject: reset ? "Your ZYRAVA password reset code" : "Your ZYRAVA sign-in code",
    text: `${title}\n\nUse this code to ${action}: ${code}\n\nThis code expires in 10 minutes and can only be used once. Never share it. If you did not request this, ignore this email.\n\nZYRAVA · Your songs. Your little world.`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#15241e"><span style="display:none">Your secure ZYRAVA verification code. Valid for 10 minutes.</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border:1px solid #e2ebe6;border-radius:24px"><tr><td style="padding:36px"><img src="cid:zyrava-logo" width="52" height="52" alt="ZYRAVA" style="display:block;border-radius:12px"><p style="font-size:12px;font-weight:700;letter-spacing:4px;margin:20px 0 30px">ZYRAVA</p><h1 style="font-size:28px;line-height:1.2;margin:0 0 16px">${title}</h1><p style="font-size:15px;line-height:1.7;color:#53675c">Enter the code below to ${action}.</p><div style="margin:28px 0;padding:24px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:16px;text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;color:#065f46">${code}</div><p style="font-size:13px;line-height:1.7;color:#53675c">Valid for <strong>10 minutes</strong>. This code works once. For your security, never share it with anyone.</p><hr style="border:0;border-top:1px solid #e2ebe6;margin:28px 0"><p style="font-size:12px;line-height:1.7;color:#718279">Didn't request this? You can safely ignore this email. Your password will stay unchanged.</p><p style="font-size:12px;color:#53675c;margin:24px 0 0">Your songs. Your little world.<br><strong>Team ZYRAVA</strong></p></td></tr></table></td></tr></table></body></html>`,
    attachments: [{ filename: "zyrava.png", path: fileURLToPath(new URL("../assets/email-logo.png", import.meta.url)), cid: "zyrava-logo" }],
  };
}

export async function sendEmail(email, message, { idempotencyKey } = {}) {
  try {
    if (env.emailProvider === "gmail") {
      await sendGmailEmail(email, message);
    } else if (env.emailProvider === "resend") {
      if (!env.resendApiKey || !env.emailFrom) throw deliveryError("missing_configuration");
      const attachments = await Promise.all((message.attachments ?? []).map(async attachment => ({
        filename: attachment.filename,
        content: (await readFile(attachment.path)).toString("base64"),
        content_type: "image/png",
        content_id: attachment.cid,
      })));
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ from: env.emailFrom, to: [email], subject: message.subject, text: message.text, html: message.html, attachments }),
      });
      // Never log provider response bodies: they may include recipient details.
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        // Inspect known phrases only to classify; never store or return provider text.
        const explanation = String(detail.message || "");
        const reason = response.status === 429 || /quota/i.test(explanation) ? "rate_limited"
          : response.status === 401 || /api key|permission/i.test(explanation) ? "api_authentication"
          : /only send testing emails/i.test(explanation) ? "testing_only"
          : /domain.*not verified/i.test(explanation) ? "sender_not_verified" : "provider_rejected";
        throw deliveryError(reason);
      }
      const result = await response.json();
      if (!result.id) throw deliveryError("provider_rejected");
    } else if (env.emailProvider === "smtp") {
      await mailTransport().sendMail({ from: { name: "ZYRAVA", address: env.smtpUser }, to: email, ...message });
    } else {
      throw deliveryError("invalid_provider");
    }
    recordEmailAccepted();
  } catch (error) {
    // Transport errors can contain credentials or recipients; do not log them.
    const mailCode = recordEmailFailure(error);
    const failure = new AppError(503, "We couldn't send the email. Please try again shortly.");
    failure.mailCode = mailCode;
    throw failure;
  }
}

export async function sendOtpEmail(email, code, purpose) {
  return sendEmail(email, otpEmail(code, purpose));
}
