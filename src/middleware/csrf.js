import crypto from "node:crypto";
import { CSRF_COOKIE, setCsrfCookie } from "../utils/cookies.js";

/**
 * Double-submit CSRF: a random token lives in a readable cookie and must be
 * echoed in `X-CSRF-Token` on every state-changing request. Cross-site pages
 * can send the cookie but cannot read it, so they cannot produce the header.
 */
export function ensureCsrf(req, res) {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const token = crypto.randomBytes(32).toString("base64url");
  setCsrfCookie(res, token);
  return token;
}

export function issueCsrf(req, res) {
  const csrfToken = ensureCsrf(req, res);
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken });
}

export function verifyCsrf(req, res, next) {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");

  if (typeof cookie !== "string" || typeof header !== "string" || cookie.length !== header.length) {
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
  }

  const cookieBuffer = Buffer.from(cookie);
  const headerBuffer = Buffer.from(header);
  if (
    cookieBuffer.length !== headerBuffer.length ||
    !crypto.timingSafeEqual(cookieBuffer, headerBuffer)
  ) {
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
  }

  return next();
}
