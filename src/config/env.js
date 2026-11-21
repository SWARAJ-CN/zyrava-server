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
  emailOtpEnabled: process.env.EMAIL_OTP_ENABLED === "true",
  smtpHost: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER?.trim(),
  smtpPassword: process.env.SMTP_PASSWORD?.replace(/\s/g, ""),
  paymentSettingsEncryptionKey: process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY?.trim(),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID?.trim(),
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET?.trim(),
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim(),
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
