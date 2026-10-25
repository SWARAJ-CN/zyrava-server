import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const isProd = process.env.NODE_ENV === "production";
const accessSecret = required("JWT_ACCESS_SECRET");
const refreshSecret = required("JWT_REFRESH_SECRET");

if (isProd && (accessSecret.length < 32 || refreshSecret.length < 32)) {
  throw new Error("JWT secrets must each be at least 32 characters in production.");
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 5000),
  mongoUri: required("MONGO_URI"),
  accessSecret,
  refreshSecret,
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshDays: Number(process.env.REFRESH_DAYS ?? 7),
  rememberDays: Number(process.env.REMEMBER_DAYS ?? 30),
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
  clientOrigins: (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
};
