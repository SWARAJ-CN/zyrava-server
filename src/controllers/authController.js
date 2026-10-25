import { asyncHandler } from "../utils/http.js";
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
} from "../utils/cookies.js";
import * as authService from "../services/authService.js";

function requestMeta(req) {
  return {
    userAgent: (req.get("user-agent") ?? "").slice(0, 220),
    ip: (req.ip ?? "").slice(0, 64),
  };
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.registerAccount(req.valid.body, requestMeta(req));
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.status(201).json({ user: result.user, accessToken: result.accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.loginAccount(req.valid.body, requestMeta(req));
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.json({ user: result.user, accessToken: result.accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.rotateSession(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.json({ user: result.user, accessToken: result.accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.revokeSession(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).end();
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.findUser(req.userId);
  res.json({ user });
});
