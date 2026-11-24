import { User } from "../models/User.js";
import { AppError } from "../utils/http.js";
import { verifyAccessToken } from "../utils/tokens.js";

/** Bearer access token, stateless and never stored in a cookie. */
export async function requireAuth(req, res, next) {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Sign in required." });
  }

  try {
    const payload = await validateAccessSession(token);
    req.userId = payload.sub;
    return next();
  } catch (error) {
    if (error.status === 401 || ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
      return res.status(401).json({ error: "Session expired." });
    }
    // A transient database failure is not evidence that the user signed out.
    return next(error);
  }
}

export async function validateAccessSession(token) {
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).select("authVersion").lean();
  if (!user || (payload.av ?? 0) !== (user.authVersion ?? 0)) throw new AppError(401, "Session expired");
  return payload;
}
