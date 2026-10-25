import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ISSUER = "zyrava";
const AUDIENCE = "zyrava-web";

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), typ: "access" },
    env.accessSecret,
    { expiresIn: env.accessTtl, issuer: ISSUER, audience: AUDIENCE }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.accessSecret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/** 384 bits of entropy — safe to hand to the browser. */
export function newRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

/** The database only ever sees this peppered hash. */
export function hashToken(token) {
  return crypto.createHmac("sha256", env.refreshSecret).update(token).digest("hex");
}

export function refreshExpiry(remember) {
  const days = remember ? env.rememberDays : env.refreshDays;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
