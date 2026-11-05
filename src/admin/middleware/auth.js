import { verifyToken } from "../services/authService.js";
import { adminEnv } from "../env.js";

export function requireAdmin(req, res, next) {
  if (!adminEnv.configured) {
    return res.status(503).json({
      error:
        "Admin access is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_JWT_SECRET on zyrava-server.",
    });
  }

  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Administrator sign-in required." });
  }

  try {
    const payload = verifyToken(token);
    if (payload.typ !== "admin-access") throw new Error("Wrong token type");
    req.admin = { email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Your admin session has expired. Sign in again." });
  }
}
