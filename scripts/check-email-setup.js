import { env } from "../src/config/env.js";
import { mailTransport } from "../src/services/emailService.js";
import { gmailAccessToken } from "../src/services/gmailTransport.js";
import { emailDiagnostics, recordEmailFailure } from "../src/services/emailDiagnostics.js";
if (env.emailProvider === "gmail") {
  const { missing } = emailDiagnostics();
  if (missing.length) {
    console.error(`Email setup incomplete: add ${missing.join(", ")} to the backend environment.`);
    process.exitCode = 1;
  } else {
    try {
      await gmailAccessToken();
      console.log("Gmail OAuth token refresh succeeded over HTTPS. No email was sent. Test an OTP to verify Gmail API permissions and inbox delivery.");
    } catch (error) { recordEmailFailure(error); process.exitCode = 1; }
  }
} else if (env.emailProvider === "resend") {
  const missing = [!env.resendApiKey && "RESEND_API_KEY", !env.emailFrom && "EMAIL_FROM"].filter(Boolean);
  if (missing.length) {
    console.error(`Email setup incomplete: add ${missing.join(", ")} to the backend environment.`);
    process.exitCode = 1;
  } else {
    console.log("Resend HTTPS configuration is present. No email was sent; API key validity and sender-domain verification have not been tested. Confirm both in Resend, then test an OTP login.");
  }
} else if (env.emailProvider !== "smtp") {
  console.error("EMAIL_PROVIDER must be smtp, gmail or resend.");
  process.exitCode = 1;
} else {
  const missing = [!env.smtpUser && "SMTP_USER", !env.smtpPassword && "SMTP_PASSWORD"].filter(Boolean);
  if (missing.length) {
    console.error(`Email setup incomplete: add ${missing.join(", ")} to the backend environment.`);
    process.exitCode = 1;
  } else {
    try {
      await mailTransport().verify();
      console.log("SMTP authentication succeeded. No email was sent.");
      console.log(env.emailOtpEnabled ? "Email OTP is enabled." : "Set EMAIL_OTP_ENABLED=true and restart the backend to activate email OTP.");
    } catch {
      console.error("SMTP verification failed. Check the sender address, app password and outbound network access. Render Free blocks SMTP ports 465 and 587.");
      process.exitCode = 1;
    }
  }
}
