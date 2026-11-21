import { env } from "../config/env.js";
import { mailTransport } from "./emailService.js";
import { EmailChallenge } from "../models/EmailChallenge.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";

/** Idempotent rollout: verified sessions survive restarts; phone-only users are untouched. */
export async function prepareEmailAuthentication() {
  if (!env.emailOtpEnabled) return;
  try { await mailTransport().verify(); }
  catch { throw new Error("Email OTP is enabled, but SMTP verification failed. Check the backend SMTP settings and network access."); }
  await EmailChallenge.init();
  let batch = [];
  for await (const user of User.find({ email: { $type: "string", $ne: "" } }).select("_id").cursor()) {
    batch.push(user._id);
    if (batch.length === 500) {
      await Session.deleteMany({ user: { $in: batch }, emailOtpVerified: { $ne: true } });
      batch = [];
    }
  }
  if (batch.length) await Session.deleteMany({ user: { $in: batch }, emailOtpVerified: { $ne: true } });
}
