import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { adminEnv, requireAdminConfigured } from "../env.js";
import { AppError } from "../../utils/http.js";

const ISSUER = "zyrava-admin";
const AUDIENCE = "zyrava-admin-web";

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function login({ email, password }) {
  requireAdminConfigured();

  if (typeof email !== "string" || typeof password !== "string") {
    throw new AppError(422, "Email and password are required.");
  }

  const emailMatches = safeEqual(email.trim().toLowerCase(), adminEnv.email);
  const configuredHash = adminEnv.password.startsWith("$2");
  const passwordMatches = configuredHash
    ? await bcrypt.compare(password, adminEnv.password)
    : safeEqual(password, adminEnv.password);

  if (!emailMatches || !passwordMatches) {
    throw new AppError(401, "Invalid administrator credentials.");
  }

  const expiresAt = new Date(Date.now() + adminEnv.sessionHours * 60 * 60 * 1000);
  const token = jwt.sign(
    { sub: "admin", email: adminEnv.email, typ: "admin-access" },
    adminEnv.jwtSecret,
    {
      expiresIn: `${adminEnv.sessionHours}h`,
      issuer: ISSUER,
      audience: AUDIENCE,
    }
  );

  return {
    token,
    expiresAt,
    admin: { email: adminEnv.email },
    config: { allowDelete: adminEnv.allowDelete, apiUrl: adminEnv.apiUrl },
  };
}

export function verifyToken(token) {
  return jwt.verify(token, adminEnv.jwtSecret, { issuer: ISSUER, audience: AUDIENCE });
}
