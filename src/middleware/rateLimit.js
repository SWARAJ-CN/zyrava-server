import rateLimit from "express-rate-limit";

const message = (error) => ({ error });

/**
 * Free-tier sizing: the API only serves auth, so these ceilings are generous
 * for a person and hostile to a script. A single Render instance keeps the
 * store in memory; if you ever scale out, swap in a Redis store.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many requests. Slow down for a moment."),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: message("Too many sign-in attempts. Try again in a few minutes."),
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many session refreshes. Sign in again."),
});

/** Account creation is cheap to spam, so it gets its own hourly ceiling. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: message("Too many accounts created from this network. Try later."),
});

/**
 * Listening history is written by the app as it plays, so the ceiling is per
 * account rather than per network: a shared family connection can still stream.
 */
export const historyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip,
  message: message("Too many history writes at once. The app will catch up."),
});
