import mongoose from "mongoose";
import { env } from "../config/env.js";
import { EmailChallenge } from "../models/EmailChallenge.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";

/** Idempotent rollout: verified sessions survive restarts; phone-only users are untouched. */
export async function prepareEmailAuthentication() {
  if (!env.emailOtpEnabled) return;
  // Email delivery is checked when sending, not during boot. A provider outage
  // must not take down playback or phone login, or bypass email verification.
  await EmailChallenge.init();
  // These operators are server-owned; retain global sanitization for input.
  let batch = [];
  for await (const user of User.find({ email: mongoose.trusted({ $type: "string", $ne: "" }) }).select("_id").cursor()) {
    batch.push(user._id);
    if (batch.length === 500) {
      await Session.deleteMany({ user: mongoose.trusted({ $in: batch }), emailOtpVerified: mongoose.trusted({ $ne: true }) });
      batch = [];
    }
  }
  if (batch.length) await Session.deleteMany({ user: mongoose.trusted({ $in: batch }), emailOtpVerified: mongoose.trusted({ $ne: true }) });
}
