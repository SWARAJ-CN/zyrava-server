import { asyncHandler } from "../utils/http.js";
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
} from "../utils/cookies.js";
import * as emailOtp from "../services/emailOtpService.js";
import * as authService from "../services/authService.js";

function requestMeta(req) {
  return {
    userAgent: (req.get("user-agent") ?? "").slice(0, 220),
    ip: (req.ip ?? "").slice(0, 64),
  };
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.registerAccount(req.valid.body, requestMeta(req));
  if (result.requiresOtp) return res.status(202).json(result);
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.status(201).json({ user: result.user, accessToken: result.accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.loginAccount(req.valid.body, requestMeta(req));
  if (result.requiresOtp) return res.status(202).json(result);
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.json({ user: result.user, accessToken: result.accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.rotateSession(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
  if (result.requiresOtp) return res.status(202).json(result);
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

export const verifyEmailLogin = asyncHandler(async (req, res) => {
  const result = await authService.completeEmailLogin(req.valid.body, requestMeta(req));
  setRefreshCookie(res, result.refreshToken, result.expiresAt);
  res.json({ user: result.user, accessToken: result.accessToken });
});
export const resendEmail = asyncHandler(async (req, res) => {
  const { challengeId, purpose } = req.valid.body;
  res.json(await emailOtp.resendEmailChallenge(challengeId, purpose));
});
export const requestReset = asyncHandler(async (req, res) => {
  res.json(await emailOtp.requestPasswordReset(req.valid.body.email));
});
export const verifyReset = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.valid.body;
  const { resetToken } = await emailOtp.verifyEmailChallenge(challengeId, code, "reset");
  res.json({ resetToken, expiresIn: 600 });
});
export const finishReset = asyncHandler(async (req, res) => {
  const { resetToken, password } = req.valid.body;
  res.json(await emailOtp.finishPasswordReset(resetToken, password));
});
