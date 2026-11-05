import { AppError } from "../utils/http.js";

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() || null;
const password = process.env.ADMIN_PASSWORD ?? null;
// Prefer a dedicated admin secret; falling back keeps existing deployments
// booting without a new variable while still separating issuer/audience.
const jwtSecret =
  (process.env.ADMIN_JWT_SECRET ?? "").trim() || process.env.JWT_ACCESS_SECRET || "";

export const adminEnv = {
  configured: Boolean(email && password && jwtSecret),
  email,
  password,
  jwtSecret,
  sessionHours: number("ADMIN_SESSION_HOURS", 12),
  allowDelete: bool("ADMIN_ALLOW_DELETE", true),
  cacheTtlMs: number("ADMIN_CACHE_TTL_MS", 5_000),
  apiUrl: (process.env.ZYRAVA_API_URL ?? "https://zyrava-server.onrender.com").replace(/\/$/, ""),
};

export function requireAdminConfigured() {
  if (!adminEnv.configured) {
    throw new AppError(
      503,
      "Admin access is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_JWT_SECRET on zyrava-server."
    );
  }
}
