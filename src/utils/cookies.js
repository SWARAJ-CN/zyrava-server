import { env } from "../config/env.js";

export const REFRESH_COOKIE = "zyrava_refresh";
export const CSRF_COOKIE = "zyrava_csrf";

/**
 * Local dev runs both apps on localhost, which is same-site: Lax is enough and
 * keeps the cookie usable over http. Production puts Vercel (frontend) and
 * Render (API) on different sites, so the refresh cookie must be
 * SameSite=None + Secure.
 */
const crossSite = env.isProd;

const base = {
  secure: crossSite,
  sameSite: crossSite ? "none" : "lax",
  domain: env.cookieDomain,
};

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    ...base,
    httpOnly: true,
    path: "/api/auth",
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: "/api/auth" });
}

/** Readable by the SPA on purpose: it is echoed back in a header. */
export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    path: "/",
    maxAge: 2 * 60 * 60 * 1000,
  });
}
