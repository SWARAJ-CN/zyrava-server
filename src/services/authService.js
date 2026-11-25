import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { AppError } from "../utils/http.js";
import {
  hashToken,
  newRefreshToken,
  refreshExpiry,
  signAccessToken,
} from "../utils/tokens.js";
import { normalizePhone } from "../validators/auth.js";
import { accountExperience } from "./accountExperience.js";

import { publicCustomization } from "../models/customizationFields.js";

const BCRYPT_ROUNDS = 10;
/** A real hash so a missing account costs the same compare as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync("zyrava-invalid-password", BCRYPT_ROUNDS);

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name ?? null,
    avatarUrl: user.avatar?.url ?? null,
    email: user.email ?? null,
    phone: user.phone ?? null,
    createdAt: user.createdAt,
    experience: accountExperience(user),
    customization: accountExperience(user) === "standard" ? publicCustomization(user.customization) : null,
  };
}

async function issueSession(user, remember, meta) {
  const refreshToken = newRefreshToken();
  const expiresAt = refreshExpiry(remember);

  await Session.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    remember,
    authVersion: user.authVersion ?? 0,
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken,
    expiresAt,
  };
}

export async function registerAccount(input, meta) {
  const email = input.email;
  const phone = input.phone;

  const existing = await User.exists({
    $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
  });
  if (existing) {
    throw new AppError(409, "An account with that email or phone already exists.");
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await User.create({
    name: input.name,
    email,
    phone,
    passwordHash,
  });

  const result = await issueSession(user, input.remember, meta);
  return result;
}

export async function loginAccount(input, meta) {
  const identifier = input.identifier.includes("@")
    ? input.identifier.toLowerCase()
    : normalizePhone(input.identifier);

  const query = input.identifier.includes("@") ? { email: identifier } : { phone: identifier };
  const user = await User.findOne(query).select("+passwordHash");

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_HASH
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "Invalid email, phone number or password.");
  }

  const result = await issueSession(user, input.remember, meta);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return result;
}

export async function rotateSession(refreshToken, meta) {
  if (!refreshToken) throw new AppError(401, "Your session has expired. Sign in again.");

  // Delete-then-issue makes replay of an old token fail immediately.
  const session = await Session.findOneAndDelete({ tokenHash: hashToken(refreshToken) });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, "Your session has expired. Sign in again.");
  }

  const user = await User.findById(session.user);
  if (!user) throw new AppError(401, "This account no longer exists.");

  if ((session.authVersion ?? 0) !== (user.authVersion ?? 0)) {
    throw new AppError(401, "Your session has expired. Sign in again.");
  }
  return issueSession(user, session.remember, meta);
}

export async function revokeSession(refreshToken) {
  if (!refreshToken) return;
  await Session.deleteOne({ tokenHash: hashToken(refreshToken) });
}

export async function findUser(userId) {
  const user = await User.findById(userId).select("name email phone createdAt customization").lean();
  if (!user) throw new AppError(404, "Account not found.");
  return publicUser(user);
}
