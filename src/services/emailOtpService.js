import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { EmailChallenge } from "../models/EmailChallenge.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { env } from "../config/env.js";
import { hashToken } from "../utils/tokens.js";
import { AppError } from "../utils/http.js";
import { sendOtpEmail } from "./emailService.js";
import { getIo, userRoom } from "../realtime/rooms.js";

const TTL = 10 * 60_000;
const COOLDOWN = 60_000;
const invalid = () => new AppError(400, "That code is incorrect or expired. Request a new code.");
const enabled = () => { if (!env.emailOtpEnabled) throw new AppError(503, "Email verification is not available yet."); };
export const otpDigest = (token, code) => hashToken(`email-otp:${token}:${code}`);
const token = () => crypto.randomBytes(32).toString("hex");
const code = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
function challengeResponse(challengeId, email, purpose) {
  const [local, domain] = email.split("@");
  return { requiresOtp: true, challengeId, purpose, destination: `${local.slice(0, 1)}***@${domain}`, expiresIn: 600, resendAfter: 60 };
}

export async function startEmailChallenge(user, purpose, remember = false) {
  enabled();
  if (!user.email) throw new AppError(400, "Email verification is only available for email accounts.");
  const challengeId = token(), otp = code(), now = new Date();
  let challenge;
  try {
    // Unique user/purpose index makes the per-account cooldown atomic across instances.
    challenge = await EmailChallenge.findOneAndUpdate({
      user: user._id, purpose, sentAt: { $lte: new Date(Date.now() - COOLDOWN) },
    }, { $set: { tokenHash: hashToken(challengeId), codeHash: otpDigest(challengeId, otp),
      passwordStamp: hashToken(user.passwordHash), remember, attempts: 0, sends: 1,
      sentAt: now, expiresAt: new Date(Date.now() + TTL) },
      $unset: { verifiedAt: 1, resetTokenHash: 1 } }, { upsert: true, new: true });
  } catch (error) {
    if (error.code === 11000) throw new AppError(429, "Please wait a minute before requesting another code.");
    throw error;
  }
  try { await sendOtpEmail(user.email, otp, purpose); }
  catch (error) { await EmailChallenge.deleteOne({ _id: challenge._id, tokenHash: hashToken(challengeId) }); throw error; }
  return challengeResponse(challengeId, user.email, purpose);
}

export async function requestPasswordReset(email) {
  enabled();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (user?.email) {
    try { return await startEmailChallenge(user, "reset"); }
    catch (error) { if (error.status !== 429 && error.status !== 503) throw error; }
  }
  // Same shape for unknown accounts and cooldown; never disclose membership.
  return challengeResponse(token(), email, "reset");
}

export async function resendEmailChallenge(challengeId, purpose) {
  enabled();
  const nextCode = code();
  const challenge = await EmailChallenge.findOneAndUpdate({ tokenHash: hashToken(challengeId), purpose,
    verifiedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 }, sends: { $lt: 3 },
    sentAt: { $lte: new Date(Date.now() - COOLDOWN) },
  }, { $set: { codeHash: otpDigest(challengeId, nextCode), sentAt: new Date(), expiresAt: new Date(Date.now() + TTL) }, $inc: { sends: 1 } }, { new: true });
  if (!challenge) {
    if (purpose === "reset") return { requiresOtp: true, challengeId, purpose, expiresIn: 600, resendAfter: 60 };
    throw new AppError(429, "Wait a minute, or start sign-in again if your code has expired.");
  }
  const user = await User.findById(challenge.user).select("+passwordHash");
  if (!user?.email || hashToken(user.passwordHash) !== challenge.passwordStamp) throw invalid();
  await sendOtpEmail(user.email, nextCode, purpose);
  return challengeResponse(challengeId, user.email, purpose);
}

export async function verifyEmailChallenge(challengeId, otp, purpose) {
  enabled();
  const challenge = await EmailChallenge.findOneAndUpdate({ tokenHash: hashToken(challengeId), purpose,
    verifiedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 },
  }, { $inc: { attempts: 1 } }, { new: true });
  if (!challenge || !challenge.codeHash || !crypto.timingSafeEqual(
    Buffer.from(challenge.codeHash, "hex"), Buffer.from(otpDigest(challengeId, otp), "hex")
  )) throw invalid();
  const user = await User.findById(challenge.user).select("+passwordHash");
  if (!user?.email || hashToken(user.passwordHash) !== challenge.passwordStamp) throw invalid();
  const resetToken = purpose === "reset" ? token() : null;
  // Exactly one successful verification can consume the code, even in parallel.
  const consumed = await EmailChallenge.findOneAndUpdate({ _id: challenge._id,
    tokenHash: challenge.tokenHash, codeHash: challenge.codeHash, verifiedAt: null,
    expiresAt: { $gt: new Date() }, attempts: { $lte: 5 },
  }, { $set: { verifiedAt: new Date(), ...(resetToken ? { resetTokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + TTL) } : {}) }, $unset: { codeHash: 1 } }, { new: true });
  if (!consumed) throw invalid();
  return { user, remember: challenge.remember, resetToken };
}

export async function finishPasswordReset(resetToken, password) {
  enabled();
  const grant = await EmailChallenge.findOne({ resetTokenHash: hashToken(resetToken), purpose: "reset", verifiedAt: { $ne: null }, expiresAt: { $gt: new Date() } });
  if (!grant) throw invalid();
  const user = await User.findById(grant.user).select("+passwordHash");
  if (!user?.email || hashToken(user.passwordHash) !== grant.passwordStamp) throw invalid();
  const passwordHash = await bcrypt.hash(password, 10);
  const consumed = await EmailChallenge.findOneAndDelete({ _id: grant._id, resetTokenHash: hashToken(resetToken), expiresAt: { $gt: new Date() } });
  if (!consumed) throw invalid();
  const updated = await User.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash }, $inc: { authVersion: 1 } });
  if (!updated.modifiedCount) throw invalid();
  await Session.deleteMany({ user: user._id });
  await EmailChallenge.deleteMany({ user: user._id });
  getIo()?.in(userRoom(user._id)).disconnectSockets(true);
  return { message: "Password updated. Sign in with your new password." };
}
